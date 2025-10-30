//https://script.google.com/macros/s/AKfycbxAj5s6deUUfu4TWNlG6XcZVW6R7gwtUPthRtP-UIgh9a_QCU3KfQS0YaoVICQm-zZP/exec
const SHEET_ID = '1Js6OE6o4YZ6iVtWCqkWNNqlJwkIt0R5Q-zeWno_-Z6o'; // Replace with your sheet ID
// Google Apps Script - Order Management Backend
// Deploy as Web App with "Anyone" access

const ss = SpreadsheetApp.openById(SHEET_ID);

/**
 * Creates a standardized JSON response object for the client.
 * @param {object} data The object to be stringified and returned.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- Core Handlers ---

function doGet(e) {
  const action = e.parameter.action;
  
  if (action === 'checkOrderStatus') {
    return checkOrderStatus(e.parameter.deviceId);
  } else if (action === 'getCustomerDetails') {
    return getCustomerDetails(e.parameter.deviceId);
  } else if (action === 'getRecentOrders') { // NEW ROUTE for Staff Dashboard
    return getRecentOrders();
  }
  
  return createJsonResponse({
    status: 'error',
    message: 'Invalid GET action'
  });
}

function doPost(e) {
  let data = {};

  // 1. Attempt to parse JSON body (Standard 'fetch' method)
  if (e.postData && e.postData.contents) {
    try {
      data = JSON.parse(e.postData.contents);
    } catch (error) {
      // If JSON parsing fails, we log it, but proceed to check for form data.
      Logger.log("JSON parsing failed, likely CORS-safe form data: " + error.toString());
    }
  }

  // 2. Fallback to URL parameters (CORS-safe form data method: application/x-www-form-urlencoded)
  if (!data.action && e.parameter.action) {
    data = e.parameter;
  }
  
  // 3. Process the action
  try {
    const action = data.action;
    
    if (action === 'submitOrder') {
      return submitOrder(data);
    } else if (action === 'saveCustomerDetails') {
      return saveCustomerDetails(data);
    } else if (action === 'updateOrderStatus') { // NEW ROUTE for Staff Dashboard
      return updateOrderStatus(data);
    }
    
    return createJsonResponse({
      status: 'error',
      message: 'Invalid POST action or payload not recognized.'
    });
    
  } catch (error) {
    return createJsonResponse({
      status: 'error',
      message: 'Error processing request: ' + error.toString()
    });
  }
}

// --- New Staff Dashboard Functions ---

/**
 * Retrieves the last 50 orders for the staff dashboard.
 * @return {GoogleAppsScript.Content.TextOutput} JSON response with the list of orders.
 */
function getRecentOrders() {
  const ordersSheet = ss.getSheetByName('Orders');
  if (!ordersSheet) {
    return createJsonResponse({ status: 'error', message: 'Orders sheet not found.' });
  }

  const lastRow = ordersSheet.getLastRow();
  // Fetch header row and up to the last 50 rows (plus header)
  const rowsToFetch = Math.min(lastRow, 51);
  const dataRange = ordersSheet.getRange(1, 1, rowsToFetch, ordersSheet.getLastColumn());
  const data = dataRange.getValues();
  
  const orders = [];
  
  // Start from row 1 (the first actual order)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    orders.push({
      orderId: row[0],
      deviceId: row[1],
      customerName: row[2],
      tableNumber: row[5],
      orderItems: row[6], // JSON string
      grandTotal: row[10],
      status: row[12],
      timestamp: row[13]
    });
  }
  
  // Sort by timestamp (newest first, since we fetched from the bottom up)
  orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  return createJsonResponse({
    status: 'success',
    orders: orders
  });
}

/**
 * Updates the status of a specific order.
 * @param {object} data Contains orderId and newStatus.
 * @return {GoogleAppsScript.Content.TextOutput} JSON response.
 */
function updateOrderStatus(data) {
  const { orderId, newStatus } = data;
  
  if (!orderId || !newStatus) {
    return createJsonResponse({ status: 'error', message: 'Missing orderId or newStatus.' });
  }

  const ordersSheet = ss.getSheetByName('Orders');
  if (!ordersSheet) {
    return createJsonResponse({ status: 'error', message: 'Orders sheet not found.' });
  }

  const dataRange = ordersSheet.getDataRange();
  const values = dataRange.getValues();
  
  let orderRowIndex = -1;
  
  // Find the row matching the orderId (skip header row)
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === orderId) {
      orderRowIndex = i + 1; // 1-based index for GAS Range
      break;
    }
  }
  
  if (orderRowIndex > 0) {
    // Status is in column M, which is the 13th column (index 12)
    const STATUS_COL = 13; 
    
    // Update the status cell
    ordersSheet.getRange(orderRowIndex, STATUS_COL).setValue(newStatus);
    
    return createJsonResponse({
      status: 'success',
      message: `Order ${orderId} status updated to ${newStatus}.`
    });
  } else {
    return createJsonResponse({
      status: 'error',
      message: `Order ID ${orderId} not found.`
    });
  }
}

// --- Existing Functions ---

function submitOrder(data) {
  const ordersSheet = ss.getSheetByName('Orders');
  
  if (!ordersSheet) {
    throw new Error("Orders sheet not found.");
  }

  // Generate Order ID
  const orderId = 'ORD' + Date.now();
  
  // Handle orderItems: The CORS-safe form method doesn't support complex objects directly.
  let orderItems;
  if (data.orderItems && typeof data.orderItems === 'string') {
    // If it's a string, try to parse it (if client stringified it)
    try {
        orderItems = JSON.parse(data.orderItems);
    } catch (e) {
        // Fallback for simple form data that doesn't include the full JSON array
        orderItems = [{ name: 'Default Item (Form Data)', quantity: 1, price: data.grandTotal || 0 }];
    }
  } else if (data.orderItems) {
      // It came as a parsed JSON array
      orderItems = data.orderItems;
  } else {
      orderItems = [{ name: 'Missing Item Data', quantity: 1, price: data.grandTotal || 0 }];
  }
  
  // Prepare row data (ensure column order matches your sheet layout)
  const rowData = [
    orderId,
    data.deviceId || '',
    data.customerName || '',
    data.customerPhone || '',
    data.customerAddress || '',
    data.tableNumber || '',
    JSON.stringify(orderItems),
    data.subtotal || 0,
    data.discount || 0,
    data.gst || 0,
    data.grandTotal || 0,
    data.generalInstructions || '',
    'Pending',
    new Date(),
    data.locationLat || '',
    data.locationLng || '',
    data.distanceKm || ''
  ];
  
  // Append to sheet
  ordersSheet.appendRow(rowData);
  
  // Update customer record
  updateCustomerRecord(data.deviceId, data.customerName, data.customerPhone, data.customerAddress);
  
  return createJsonResponse({
    status: 'success',
    orderId: orderId,
    message: 'Order submitted successfully'
  });
}

function updateCustomerRecord(deviceId, name, phone, address) {
  const customersSheet = ss.getSheetByName('Customers');
  if (!customersSheet) {
    throw new Error("Customers sheet not found for updating.");
  }

  const data = customersSheet.getDataRange().getValues();
  
  // Find existing customer
  let customerRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === deviceId) {
      customerRow = i + 1; // 1-based index for GAS Range
      break;
    }
  }
  
  // Column indices for Customers sheet (assuming: DeviceId=1, Name=2, Phone=3, Address=4, FirstOrderDate=5, LastOrderDate=6, TotalOrders=7)
  const NAME_COL = 2;
  const PHONE_COL = 3;
  const ADDRESS_COL = 4;
  const LAST_ORDER_DATE_COL = 6;
  const TOTAL_ORDERS_COL = 7; 

  if (customerRow > 0) {
    // Update existing customer
    const currentOrders = customersSheet.getRange(customerRow, TOTAL_ORDERS_COL).getValue();
    customersSheet.getRange(customerRow, NAME_COL).setValue(name);
    customersSheet.getRange(customerRow, PHONE_COL).setValue(phone);
    customersSheet.getRange(customerRow, ADDRESS_COL).setValue(address);
    customersSheet.getRange(customerRow, LAST_ORDER_DATE_COL).setValue(new Date()); 
    customersSheet.getRange(customerRow, TOTAL_ORDERS_COL).setValue(currentOrders + 1);
  } else {
    // Add new customer
    customersSheet.appendRow([
      deviceId,
      name,
      phone,
      address,
      new Date(), // First order date
      new Date(), // Last order date
      1 // Total orders
    ]);
  }
}

function checkOrderStatus(deviceId) {
  const ordersSheet = ss.getSheetByName('Orders');
  if (!ordersSheet) {
    return createJsonResponse({ status: 'error', message: 'Orders sheet not found.' });
  }

  const data = ordersSheet.getDataRange().getValues();
  
  const orders = [];
  
  // Get all orders for this device (skip header row)
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === deviceId) {
      orders.push({
        orderId: data[i][0],
        status: data[i][12],
        timestamp: data[i][13],
        grandTotal: data[i][10],
        tableNumber: data[i][5]
      });
    }
  }
  
  // Sort by timestamp (newest first)
  orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  return createJsonResponse({
    status: 'success',
    orders: orders
  });
}

function getCustomerDetails(deviceId) {
  const customersSheet = ss.getSheetByName('Customers');
  if (!customersSheet) {
    return createJsonResponse({ status: 'error', message: 'Customers sheet not found.' });
  }

  const data = customersSheet.getDataRange().getValues();
  
  // Find customer
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === deviceId) {
      return createJsonResponse({
        status: 'success',
        customer: {
          deviceId: data[i][0],
          name: data[i][1],
          phone: data[i][2],
          address: data[i][3],
          totalOrders: data[i][6] // Assuming TotalOrders is column 7 (index 6)
        }
      });
    }
  }
  
  return createJsonResponse({
    status: 'success',
    customer: null
  });
}

function saveCustomerDetails(data) {
  try {
    // Note: Calling updateCustomerRecord here will also increment TotalOrders count.
    updateCustomerRecord(data.deviceId, data.name, data.phone, data.address);
    
    return createJsonResponse({
      status: 'success',
      message: 'Customer details saved'
    });
  } catch (error) {
    return createJsonResponse({
      status: 'error',
      message: 'Failed to save customer details: ' + error.message
    });
  }
}
