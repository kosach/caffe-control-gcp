# Google Apps Script - Fixed Version

## Issues Found & Fixed

### Issue 1: Bonus Logic Incorrect
❌ **Problem**: The old code aggregated by month, but bonuses should be calculated per DAY:
- 7000 bonus: if daily sales >= 7000 UAH
- 130 bonus: if average check per day >= 130 UAH

✅ **Solution**: Aggregate by user AND date, then check bonuses per day.

### Issue 2: Data Type Inconsistency
❌ **Problem**: `payed_sum` is a string "15800", not a number
✅ **Solution**: Explicit parseFloat conversion

## Fixed Code

```javascript
function getMonthNumberFromName(monthName) {
  const year = new Date().getFullYear();
  return new Date(\`\${monthName} 1, \${year}\`).getMonth();
}

// Updated to use GCP getAllTransactions endpoint
function getSalleryData(monthName = 'February'){
  const date = new Date(), y = date.getFullYear()
  const month = getMonthNumberFromName(monthName);

  const firstDay = Utilities.formatDate(new Date(y, month, 1), 'GMT+3', 'yyyy-MM-dd');
  const lastDay = Utilities.formatDate(new Date(y, month + 1, 0), 'GMT+3', 'yyyy-MM-dd')

  // NEW GCP ENDPOINT
  const url = \`https://getalltransactions-5txnprikja-ew.a.run.app?auth-token=caffe-secure-2025-prod-key-x7k9m&startDate=\${firstDay}&endDate=\${lastDay}&limit=10000\`;

  const res = UrlFetchApp.fetch(url);
  const transactions = JSON.parse(res.getContentText());

  // Aggregate by user (client-side)
  return aggregateByUser(transactions);
}

// NEW: Aggregate transactions by user AND DATE for proper bonus calculation
function aggregateByUser(transactions) {
  // First, group by user and date
  const dailyStats = {};

  transactions.forEach(tx => {
    const userName = tx.name || 'Unknown';
    const txDate = tx.date_close_date.split(' ')[0]; // "2025-10-01"
    const key = \`\${userName}|\${txDate}\`;

    if (!dailyStats[key]) {
      dailyStats[key] = {
        name: userName,
        date: txDate,
        daily_sum: 0,
        daily_transactions: 0,
        bonus_3percent: 0
      };
    }

    // Sum for this specific day
    const payedSum = parseFloat(tx.payed_sum || 0);
    dailyStats[key].daily_sum += payedSum;
    dailyStats[key].daily_transactions++;
    dailyStats[key].bonus_3percent += payedSum * 0.03;
  });

  // Now aggregate by user for the month, tracking bonus-qualifying days
  const userMonthlyStats = {};

  Object.values(dailyStats).forEach(dailyData => {
    const userName = dailyData.name;

    if (!userMonthlyStats[userName]) {
      userMonthlyStats[userName] = {
        name: userName,
        days: 0,
        total_payed_sum: 0,
        number_of_transactions: 0,
        bonus_3percent: 0,
        days_with_7000: 0,      // NEW: days where sales >= 7000
        days_with_130_avg: 0    // NEW: days where avg check >= 130
      };
    }

    userMonthlyStats[userName].days++;
    userMonthlyStats[userName].total_payed_sum += dailyData.daily_sum;
    userMonthlyStats[userName].number_of_transactions += dailyData.daily_transactions;
    userMonthlyStats[userName].bonus_3percent += dailyData.bonus_3percent;

    // Check bonuses for THIS DAY
    if (dailyData.daily_sum >= 7000) {
      userMonthlyStats[userName].days_with_7000++;
    }

    const avgCheckThisDay = dailyData.daily_sum / dailyData.daily_transactions;
    if (avgCheckThisDay >= 130) {
      userMonthlyStats[userName].days_with_130_avg++;
    }
  });

  // Convert to array format
  return Object.values(userMonthlyStats);
}

function SalaryImport(monthName) {
  const data = getSalleryData(monthName);
  const results = [Object.keys(data[0])]
  data.forEach(el => results.push(results[0].map(key => el[key])))
  return results;
}

function objectToMatrix(obj) {
  const headers = Object.keys(obj);
  const columns = Object.values(obj);
  const columnNames = Object.keys(columns[0])

  const matrix = [
    ['', ...headers],
  ];

  for (const column of columnNames) {
    const data = headers.map(header => obj[header][column])
    const row = [column, ...data]
    matrix.push(row)
  }

  return matrix;
}

function SallaryResults(monthName = 'February'){
  const data = getSalleryData(monthName).map(el => {
    if(el.name === 'Настя'){
      el.bonus_3percent = 0; // Fixed: was bonus_3%, now bonus_3percent
    }
    return el;
  });

  const salaryData = {
     'Настя': 900,
     'Софія': 800,
     'Олег': 1000,
     'Марта': 850,
     'Діана': 1000,
     'Настя Пивовар': 900,
     'Олександра': 900,
     'Сашко': 1000,
  }

  const bonuses = {
    '130': 150,
    '7000': 100,
  }

  const preparedData = data.reduce((acummulator, currentvalue) => {
    const name = currentvalue.name;

    if(!acummulator[name]) {
      acummulator[name] = {
        days: 0,
        '3%': 0,
        7000: 0,
        130: 0,
      };
    }

    // Use the pre-calculated values from aggregateByUser
    acummulator[name].days = currentvalue.days;
    acummulator[name]['3%'] = currentvalue.bonus_3percent;
    acummulator[name][7000] = currentvalue.days_with_7000;      // Fixed!
    acummulator[name][130] = currentvalue.days_with_130_avg;    // Fixed!

    return acummulator;
  }, {})

  Object.keys(preparedData).forEach(key => {
    preparedData[key].salary = preparedData[key].days * salaryData[key];
    preparedData[key].bonus = (preparedData[key]['7000'] * bonuses['7000']) + (preparedData[key]['130'] * bonuses['130']);
  })

  const results = objectToMatrix(preparedData);
  return results;
}

function CalculateMAE(rangeA, rangeB) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var actualData = sheet.getRange(rangeA).getValues();
  var predictedData = sheet.getRange(rangeB).getValues();

  if (actualData.length !== predictedData.length) {
    throw new Error("The ranges must be the same length.");
  }

  var totalAbsoluteError = 0;

  for (var i = 0; i < actualData.length; i++) {
    totalAbsoluteError += Math.abs(actualData[i][0] - predictedData[i][0]);
  }

  var mae = totalAbsoluteError / actualData.length;
  return mae;
}
```

## Key Changes

1. **Two-level aggregation**:
   - First: Group by user + date (daily stats)
   - Second: Group by user (monthly stats)

2. **Bonus calculation**:
   - Count days where daily sales >= 7000 → `days_with_7000`
   - Count days where avg check >= 130 → `days_with_130_avg`

3. **Field name fix**:
   - Changed `bonus_3%` to `bonus_3percent` (consistent naming)

4. **Removed redundant logic**:
   - `SallaryResults` now just uses pre-calculated bonus counts
   - No more incorrect comparisons

## Testing

Test with February 2025 data:
```javascript
Logger.log(SallaryResults('February'));
```

Expected output structure:
```
         Марта  Сашко  Софія
days      15     18     12
3%      3750   4200   2800
7000       3      5      1    <- Days with sales >= 7000
130        8     12      6    <- Days with avg check >= 130
salary 12750  18000   9600
bonus    900   1300    450
```
