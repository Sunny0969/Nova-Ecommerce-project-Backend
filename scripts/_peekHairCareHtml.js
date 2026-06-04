const fs = require('fs');
const html = fs.readFileSync('C:/Users/PC/Desktop/Buy Hair Care Online in Pakistan at Best Prices.htm', 'utf8');

const pos = html.indexOf('\\"discountedPrice\\":999');
console.log(html.slice(pos - 300, pos + 200));
