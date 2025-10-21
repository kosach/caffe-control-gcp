### salaryImport.gs
function getMonthNumberFromName(monthName) {
  const year = new Date().getFullYear();
  return new Date(`${monthName} 1, ${year}`).getMonth();
}

function getSalleryData(monthName = 'February'){
  const date = new Date(), y = date.getFullYear()
  console.log('monthName', getMonthNumberFromName(monthName))
  const month = getMonthNumberFromName(monthName);
  console.log('month', month)
  const firstDay = Utilities.formatDate(new Date(y, month, 1), 'GMT+3', 'yyyy-MM-dd');
  const lastDay = Utilities.formatDate(new Date(y, month + 1, 0), 'GMT+3', 'yyyy-MM-dd')
  const queryDate = `startDate=${firstDay}&endDate=${lastDay}`
  const url = `https://eu-central-1.aws.data.mongodb-api.com/app/statisticdata-tkgdc/endpoint/user/sales?auth-token=asjhdkajsd!laj129739!Asdmlmnalkjalskd__aa&${queryDate}`;
  const res = UrlFetchApp.fetch(url);

  const dataText = res.getContentText();

  const data = JSON.parse(dataText);
  return data;
}

function SalaryImport(monthName) {
  const data = getSalleryData(monthName);
  const results = [Object.keys(data[0])]
  data.forEach(el => results.push(results[0].map(key => el[key])))
  return results;
}


// SalaryImport('February')


### selleryResults
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
    console.log(el.name )
    if(el.name === 'Настя'){
      el['bonus_3%'] = 0;
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
  const preparedData = data.reduce((acummulator, currentvalue)=>{
    if(!acummulator[currentvalue.name]) acummulator[currentvalue.name] = {
      days: 0,
      7000: 0,
      130: 0,
    };

    acummulator[currentvalue.name].days++;
    acummulator[currentvalue.name]['3%'] = !acummulator[currentvalue.name]['3%'] ? currentvalue['bonus_3%'] : acummulator[currentvalue.name]['3%'] + currentvalue['bonus_3%'];
    if(currentvalue.total_payed_sum >= 7000) acummulator[currentvalue.name][7000]++;
    if(currentvalue.total_payed_sum / currentvalue.number_of_transactions >= 130) acummulator[currentvalue.name][130]++;
    return acummulator;
  }, {})
  Object.keys(preparedData).forEach(key => {
    preparedData[key].salary = preparedData[key].days * salaryData[key];
    preparedData[key].bonus = (preparedData[key]['7000'] * bonuses['7000']) + (preparedData[key]['130'] * bonuses['130']);
  })
  const results = objectToMatrix(preparedData);
  return results;
}

### calculateMae

function CalculateMAE(rangeA, rangeB) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // Отримуємо діапазони для обох наборів даних
  var actualData = sheet.getRange(rangeA).getValues();
  var predictedData = sheet.getRange(rangeB).getValues();
  
  // Переконуємося, що діапазони однакової довжини
  if (actualData.length !== predictedData.length) {
    throw new Error("The ranges must be the same length.");
  }
  
  var totalAbsoluteError = 0;
  
  // Вираховуємо абсолютну помилку для кожного елемента
  for (var i = 0; i < actualData.length; i++) {
    // Додаємо абсолютну помилку до загальної суми
    totalAbsoluteError += Math.abs(actualData[i][0] - predictedData[i][0]);
  }
  
  // Обчислюємо середнє абсолютної помилки (MAE)
  var mae = totalAbsoluteError / actualData.length;
  
  // Повертаємо результат
  return mae;
}


