# Google Sheets Integration

Integration between Google Sheets and GCP Cloud Functions for salary calculation.

## Files

- **salary-calculator.gs** - Main Google Apps Script code (copy to Google Sheets Script Editor)
- **apps-scripts-fixed.md** - Technical explanation of bug fixes

## Setup Instructions

### 1. Open Google Sheets Script Editor

1. Open your Google Sheet
2. Go to **Extensions** → **Apps Script**
3. Delete the default `Code.gs` content
4. Copy the entire content of `salary-calculator.gs`
5. Paste into the Script Editor
6. Click **Save** (💾)

### 2. Authorize the Script

First time running:
1. Run any function (e.g., `getSalleryData`)
2. Click **Review permissions**
3. Select your Google account
4. Click **Advanced** → **Go to [Project name] (unsafe)**
5. Click **Allow**

### 3. Use in Google Sheets

#### Import Raw Data

In any cell:
```
=SalaryImport("February")
```

Returns a table with all user statistics:
```
name                days  total_payed_sum  number_of_transactions  bonus_3percent  days_with_7000  days_with_130_avg
Марта              15    125000           87                      3750            3               8
Сашко              18    142000           95                      4260            5               12
...
```

#### Calculate Salary Results

In any cell:
```
=SallaryResults("February")
```

Returns calculated salaries with bonuses:
```
        Марта   Сашко   Софія
days      15      18      12
3%      3750    4260    2800
7000       3       5       1
130        8      12       6
salary 12750   18000    9600
bonus    900    1300     450
```

## Configuration

### Update Auth Token

In `salary-calculator.gs`, line 24:
```javascript
const url = `https://getalltransactions-5txnprikja-ew.a.run.app?auth-token=YOUR_TOKEN_HERE&...`;
```

Replace `YOUR_TOKEN_HERE` with your actual API key from GCP Secret Manager.

### Adjust Salary Rates

In `SallaryResults()` function (line 139):
```javascript
const salaryData = {
   'Настя': 900,
   'Софія': 800,
   'Олег': 1000,
   // ... add or update rates here
}
```

### Adjust Bonuses

In `SallaryResults()` function (line 150):
```javascript
const bonuses = {
  '130': 150,  // Bonus for days with avg check >= 130 UAH
  '7000': 100, // Bonus for days with sales >= 7000 UAH
}
```

## How It Works

### Data Flow

```
Google Sheets
    ↓ (calls function)
Apps Script
    ↓ (HTTP request)
GCP Cloud Function (getAllTransactions)
    ↓ (query)
MongoDB Atlas
    ↓ (raw transactions)
Apps Script (aggregation)
    ↓ (processed data)
Google Sheets (display)
```

### Bonus Calculation Logic

**7000 Bonus**:
- Count how many DAYS user had sales >= 7000 UAH
- Example: User worked 15 days, 3 days had sales >= 7000 → bonus = 3 × 100 = 300 UAH

**130 Bonus**:
- Count how many DAYS user's average check was >= 130 UAH
- Example: User worked 15 days, 8 days had avg check >= 130 → bonus = 8 × 150 = 1200 UAH

**3% Bonus**:
- 3% of total sales amount
- Example: Total sales 125,000 UAH → bonus = 125,000 × 0.03 = 3,750 UAH
- Can be disabled for specific users (e.g., 'Настя')

## Performance Notes

- **Limit**: Set to 10,000 transactions per month
- **Timeout**: Google Apps Script has 6-minute execution limit
- **Monthly data**: Typical month has 500-2000 transactions, well within limits

If you exceed 10,000 transactions:
1. Split by weeks: `getSalleryData('February', 1)` for week 1
2. Or increase limit in code: `&limit=20000`

## Troubleshooting

### "Loading..." forever
- Script timeout (> 6 minutes)
- Reduce date range or increase limit

### "Reference Error: UrlFetchApp is not defined"
- Running in wrong context
- Make sure code is in Google Apps Script, not plain JavaScript

### Wrong bonus calculations
- Using old code (`apps-scripts.md`)
- Use `salary-calculator.gs` instead

### "Unauthorized" error
- Wrong auth-token
- Check token in GCP Secret Manager

## Migration from Atlas

If you're migrating from the old Atlas endpoint:

**Old URL**:
```
https://eu-central-1.aws.data.mongodb-api.com/app/statisticdata-tkgdc/endpoint/user/sales
```

**New URL**:
```
https://getalltransactions-5txnprikja-ew.a.run.app
```

**Key Changes**:
1. Changed endpoint URL
2. Added client-side aggregation (`aggregateByUser` function)
3. Fixed bonus calculation logic (daily instead of monthly)

See `apps-scripts-fixed.md` for detailed explanation of fixes.

## Alternative: Backend Aggregation

For better performance, consider creating a dedicated GCP function `getSalaryByDate` that:
- Accepts `startDate`, `endDate`, `auth-token`
- Performs aggregation in MongoDB (faster)
- Returns pre-calculated user statistics

This would eliminate client-side processing and reduce data transfer.

See TODO.md for migration roadmap.
