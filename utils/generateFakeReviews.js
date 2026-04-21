const crypto = require('crypto');

const User = require('../models/User');
const Review = require('../models/Review');
const { recalculateProductRatings } = require('./recalculateProductRatings');

const PAK_NAMES = [
  'Ayesha Khan',
  'Hina Malik',
  'Sara Ahmed',
  'Maryam Iqbal',
  'Iqra Shah',
  'Sana Fatima',
  'Zainab Raza',
  'Noor Hassan',
  'Mehak Ali',
  'Anum Sheikh',
  'Ali Raza',
  'Ahmed Khan',
  'Usman Tariq',
  'Bilal Ahmed',
  'Hassan Ali',
  'Fahad Malik',
  'Hamza Khan',
  'Saad Ahmed',
  'Zeeshan Raza',
  'Imran Shah'
];

const CITY_HINTS = [
  'Karachi',
  'Lahore',
  'Islamabad',
  'Rawalpindi',
  'Faisalabad',
  'Multan',
  'Peshawar',
  'Quetta'
];

function pick(arr) {
  return arr[crypto.randomInt(0, arr.length)];
}

function randomEmail() {
  const suffix = crypto.randomBytes(6).toString('hex');
  return `reviewer.${suffix}@novashop.pk`;
}

function randomPassword() {
  return crypto.randomBytes(16).toString('hex');
}

function buildComment({ productName, rating }) {
  const city = pick(CITY_HINTS);
  const p = productName ? ` ${productName}` : ' this product';
  const templates = [
    `Good quality and packaging. Delivery was on time in ${city}. Satisfied with${p}.`,
    `Value for money. Looks premium and works as expected. Recommended.`,
    `Overall nice experience. The material feels solid and the finish is clean.`,
    `Fast delivery to ${city}. Product is exactly as shown in pictures.`,
    `Decent for the price. I wish it was a little better, but still okay.`,
    `I liked the build quality. Will order again from this store.`,
    `Excellent! Very happy with${p}.`,
    `Average experience. It’s fine but not exceptional.`,
    `Not bad. Customer support was responsive and helpful.`,
    `Great purchase. Quality exceeded my expectations.`
  ];

  // steer text a little by rating
  if (rating <= 2) {
    return `Received in ${city}. Packaging was okay, but quality could be improved. Not fully satisfied.`;
  }
  if (rating === 3) {
    return `Delivered to ${city}. Overall okay for the price. Could be better, but acceptable.`;
  }
  if (rating >= 5) {
    return pick([
      `Outstanding quality. Delivery was quick in ${city}. Highly recommended.`,
      `Perfect! Premium feel and excellent finishing. Very satisfied.`,
      `Amazing value and looks even better in person. Will buy again.`
    ]);
  }
  return pick(templates);
}

function randomCreatedAt() {
  const daysBack = crypto.randomInt(0, 91); // 0..90 days
  const hours = crypto.randomInt(0, 24);
  const mins = crypto.randomInt(0, 60);
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  d.setHours(hours, mins, 0, 0);
  return d;
}

function randomRating() {
  // Keep ratings within 2–5, but with real variation (so averages aren’t always ~4.5)
  const r = crypto.randomInt(1, 101);
  if (r <= 18) return 2;
  if (r <= 43) return 3;
  if (r <= 75) return 4;
  return 5;
}

async function generateFakeReviewsForProduct({ productId, productName, maxReviews = 10 }) {
  const n = crypto.randomInt(0, Math.max(1, maxReviews) + 1); // 0..maxReviews
  if (n === 0) {
    await recalculateProductRatings(productId);
    return { created: 0 };
  }

  const reviews = [];
  for (let i = 0; i < n; i += 1) {
    const rating = randomRating();
    const name = pick(PAK_NAMES);

    const user = await User.create({
      name,
      email: randomEmail(),
      password: randomPassword(),
      role: 'customer',
      isActive: true,
      isVerified: true,
      avatar: '',
      phone: ''
    });

    reviews.push({
      user: user._id,
      product: productId,
      rating,
      comment: buildComment({ productName, rating }),
      isVerifiedPurchase: crypto.randomInt(0, 100) < 55,
      createdAt: randomCreatedAt()
    });
  }

  await Review.insertMany(reviews, { ordered: true });
  await recalculateProductRatings(productId);
  return { created: n };
}

module.exports = { generateFakeReviewsForProduct };

