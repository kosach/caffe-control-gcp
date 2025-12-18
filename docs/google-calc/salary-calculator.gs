
function getMonthNumberFromName(monthName) {
  var year = new Date().getFullYear();
  return new Date(monthName + ' 1, ' + year).getMonth();
}

function getSalleryData(monthName){
  if (!monthName) monthName = 'February';

  var date = new Date(), y = date.getFullYear();
  var month = getMonthNumberFromName(monthName);

  var firstDay = Utilities.formatDate(new Date(y, month, 1), 'GMT+3', 'yyyy-MM-dd');
  var lastDay = Utilities.formatDate(new Date(y, month + 1, 0), 'GMT+3', 'yyyy-MM-dd');

  var url = 'https://getalltransactions-5txnprikja-ew.a.run.app?auth-token=YOUR_AUTH_TOKEN&startDate=' + firstDay + '&endDate=' + lastDay + '&limit=10000';

  Logger.log('Fetching from URL: ' + url);
  var res = UrlFetchApp.fetch(url);
  var rawData = JSON.parse(res.getContentText());

  Logger.log('Raw data type: ' + typeof rawData);
  Logger.log('Is array: ' + Array.isArray(rawData));

  // Convert to real array if it's an object with numeric keys
  var transactions = [];
  if (Array.isArray(rawData)) {
    transactions = rawData;
  } else if (typeof rawData === 'object') {
    var keys = Object.keys(rawData);
    for (var i = 0; i < keys.length; i++) {
      transactions.push(rawData[keys[i]]);
    }
  }

  Logger.log('Converted to array, length: ' + transactions.length);

  // ВАЖЛИВО: Для Dashboard потрібні ДЕННІ дані
  return getDailyStatsInternal(transactions);
}

// Формат як у старому MongoDB API
function getDailyStatsInternal(transactions) {
  Logger.log('=== getDailyStatsInternal called ===');
  Logger.log('Processing ' + transactions.length + ' transactions');

  // Validate input
  if (!transactions || !Array.isArray(transactions)) {
    Logger.log('ERROR: transactions is not an array');
    return [];
  }

  // Group by user AND date
  var dailyStats = {};

  for (var i = 0; i < transactions.length; i++) {
    var tx = transactions[i];
    var userName = tx.name || 'Unknown';
    var txDate = tx.date_close_date.split(' ')[0]; // "2025-10-01"
    var key = userName + '|' + txDate;

    if (!dailyStats[key]) {
      dailyStats[key] = {
        name: userName,
        date: txDate,
        total_payed_sum: 0,
        number_of_transactions: 0,
        'bonus_3%': 0  // ВАЖЛИВО: назва поля як у старому API
      };
    }

    // payed_sum в копійках (17000 = 170.00 UAH), конвертуємо в гривні
    var payedSum = parseFloat(tx.payed_sum || 0) / 100;
    dailyStats[key].total_payed_sum += payedSum;
    dailyStats[key].number_of_transactions++;
    dailyStats[key]['bonus_3%'] += payedSum * 0.03;
  }

  // Convert to array (one row per user per day)
  var results = [];
  for (var key in dailyStats) {
    if (dailyStats.hasOwnProperty(key)) {
      results.push(dailyStats[key]);
    }
  }

  Logger.log('Aggregated to ' + results.length + ' daily records');
  return results;
}

function aggregateByUser(transactions) {
  Logger.log('=== aggregateByUser called ===');
  
  if (!transactions || !Array.isArray(transactions)) {
    Logger.log('ERROR: transactions is not an array');
    return [];
  }

  Logger.log('Processing ' + transactions.length + ' transactions');

  // First, group by user and date
  var dailyStats = {};

  for (var i = 0; i < transactions.length; i++) {
    var tx = transactions[i];
    var userName = tx.name || 'Unknown';
    var txDate = tx.date_close_date.split(' ')[0];
    var key = userName + '|' + txDate;

    if (!dailyStats[key]) {
      dailyStats[key] = {
        name: userName,
        date: txDate,
        daily_sum: 0,
        daily_transactions: 0,
        bonus_3percent: 0
      };
    }

    var payedSum = parseFloat(tx.payed_sum || 0) / 100;
    dailyStats[key].daily_sum += payedSum;
    dailyStats[key].daily_transactions++;
    dailyStats[key].bonus_3percent += payedSum * 0.03;
  }

  // Now aggregate by user for the month
  var userMonthlyStats = {};

  var dailyStatsArray = [];
  for (var key in dailyStats) {
    if (dailyStats.hasOwnProperty(key)) {
      dailyStatsArray.push(dailyStats[key]);
    }
  }

  for (var j = 0; j < dailyStatsArray.length; j++) {
    var dailyData = dailyStatsArray[j];
    var userName = dailyData.name;

    if (!userMonthlyStats[userName]) {
      userMonthlyStats[userName] = {
        name: userName,
        days: 0,
        total_payed_sum: 0,
        number_of_transactions: 0,
        bonus_3percent: 0,
        days_with_7000: 0,
        days_with_130_avg: 0
      };
    }

    userMonthlyStats[userName].days++;
    userMonthlyStats[userName].total_payed_sum += dailyData.daily_sum;
    userMonthlyStats[userName].number_of_transactions += dailyData.daily_transactions;
    userMonthlyStats[userName].bonus_3percent += dailyData.bonus_3percent;

    if (dailyData.daily_sum >= 7000) {
      userMonthlyStats[userName].days_with_7000++;
    }

    var avgCheckThisDay = dailyData.daily_sum / dailyData.daily_transactions;
    if (avgCheckThisDay >= 130) {
      userMonthlyStats[userName].days_with_130_avg++;
    }
  }

  var results = [];
  for (var userName in userMonthlyStats) {
    if (userMonthlyStats.hasOwnProperty(userName)) {
      results.push(userMonthlyStats[userName]);
    }
  }

  Logger.log('Aggregated to ' + results.length + ' users');
  return results;
}

function SalaryImport(monthName) {
  var data = getSalleryData(monthName);

  Logger.log('SalaryImport received data type: ' + typeof data);
  Logger.log('SalaryImport data is array: ' + Array.isArray(data));
  Logger.log('SalaryImport data.length: ' + (data ? data.length : 'null'));

  if (!data || data.length === 0) {
    Logger.log('ERROR: No data returned from getSalleryData');
    return [];
  }

  Logger.log('First item keys: ' + Object.keys(data[0]).join(', '));

  // Повертаємо у форматі: [headers, ...rows]
  var results = [Object.keys(data[0])];
  for (var i = 0; i < data.length; i++) {
    var row = [];
    for (var j = 0; j < results[0].length; j++) {
      row.push(data[i][results[0][j]]);
    }
    results.push(row);
  }
  return results;
}

function objectToMatrix(obj) {
  var headers = Object.keys(obj);
  var columns = [];
  for (var i = 0; i < headers.length; i++) {
    columns.push(obj[headers[i]]);
  }
  var columnNames = Object.keys(columns[0]);

  var matrix = [[''].concat(headers)];

  for (var i = 0; i < columnNames.length; i++) {
    var column = columnNames[i];
    var data = [];
    for (var j = 0; j < headers.length; j++) {
      data.push(obj[headers[j]][column]);
    }
    var row = [column].concat(data);
    matrix.push(row);
  }

  return matrix;
}

function getRawTransactions(monthName) {
  if (!monthName) monthName = 'February';

  var date = new Date(), y = date.getFullYear();
  var month = getMonthNumberFromName(monthName);

  var firstDay = Utilities.formatDate(new Date(y, month, 1), 'GMT+3', 'yyyy-MM-dd');
  var lastDay = Utilities.formatDate(new Date(y, month + 1, 0), 'GMT+3', 'yyyy-MM-dd');

  var url = 'https://getalltransactions-5txnprikja-ew.a.run.app?auth-token=YOUR_AUTH_TOKEN&startDate=' + firstDay + '&endDate=' + lastDay + '&limit=10000';

  var res = UrlFetchApp.fetch(url);
  var rawData = JSON.parse(res.getContentText());

  var transactions = [];
  if (Array.isArray(rawData)) {
    transactions = rawData;
  } else if (typeof rawData === 'object') {
    var keys = Object.keys(rawData);
    for (var i = 0; i < keys.length; i++) {
      transactions.push(rawData[keys[i]]);
    }
  }

  // Format: [['payed_sum', 'name', 'user_id', 'date'], [...data rows...]]
  var results = [['payed_sum', 'name', 'user_id', 'date']];
  for (var i = 0; i < transactions.length; i++) {
    var tx = transactions[i];
    var payedSum = parseFloat(tx.payed_sum || 0) / 100;
    var name = tx.name || 'Unknown';
    var userId = tx.user_id || '';
    var date = tx.date_close_date ? tx.date_close_date.split(' ')[0] : '';

    results.push([payedSum, name, userId, date]);
  }

  return results;
}

// ============================================
// SALARY CALCULATION FUNCTIONS
// ============================================

function SallaryResults(monthName){
  if (!monthName) monthName = 'February';

  var dailyData = getSalleryData(monthName);

  // Remove 3% bonus for specific user
  for (var i = 0; i < dailyData.length; i++) {
    if (dailyData[i].name === 'Настя') {
      dailyData[i]['bonus_3%'] = 0;
    }
  }

  var salaryData = {
    'Настя': 900,
    'Софія': 800,
    'Олег': 1000,
    'Марта': 850,
    'Діана': 1000,
    'Настя Пивовар': 900,
    'Олександра': 900,
    'Сашко': 1000
  };

  var bonuses = {
    '130': 150,
    '7000': 100
  };

  // Aggregate daily data by user
  var preparedData = {};

  for (var i = 0; i < dailyData.length; i++) {
    var record = dailyData[i];
    var name = record.name;

    if (!preparedData[name]) {
      preparedData[name] = {
        days: 0,
        '3%': 0,
        '7000': 0,
        '130': 0
      };
    }

    preparedData[name].days++;
    preparedData[name]['3%'] += record['bonus_3%'] || 0;

    // Check daily bonuses
    if (record.total_payed_sum >= 7000) {
      preparedData[name]['7000']++;
    }

    var avgCheck = record.total_payed_sum / record.number_of_transactions;
    if (avgCheck >= 130) {
      preparedData[name]['130']++;
    }
  }

  // Calculate final salary and bonus
  var userNames = Object.keys(preparedData);
  for (var i = 0; i < userNames.length; i++) {
    var key = userNames[i];
    var dailyRate = salaryData[key] || 0;
    preparedData[key].salary = preparedData[key].days * dailyRate;
    preparedData[key].bonus = (preparedData[key]['7000'] * bonuses['7000']) + (preparedData[key]['130'] * bonuses['130']);
  }

  var results = objectToMatrix(preparedData);
  return results;
}

function CalculateMAE(rangeA, rangeB) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var actualData = sheet.getRange(rangeA).getValues();
  var predictedData = sheet.getRange(rangeB).getValues();

  if (actualData.length !== predictedData.length) {
    throw new Error('The ranges must be the same length.');
  }

  var totalAbsoluteError = 0;

  for (var i = 0; i < actualData.length; i++) {
    totalAbsoluteError += Math.abs(actualData[i][0] - predictedData[i][0]);
  }

  var mae = totalAbsoluteError / actualData.length;
  return mae;
}

