import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import Country from '../models/Country.js';
import Product from '../models/Product.js';
import Stock from '../models/Stock.js';
import AdSpend from '../models/AdSpend.js';
import DailyDelivered from '../models/DailyDelivered.js';
import Remittance from '../models/Remittance.js';
import Shipment from '../models/Shipment.js';

dotenv.config();
await connectDB();

// Admin user eas/easnew
const adminUser = await User.findOne({ username: 'eas' });
if (!adminUser) {
  const hash = await bcrypt.hash('easnew', 10);
  await User.create({ username: 'eas', passwordHash: hash, role: 'admin' });
  console.log('Admin user created: eas / easnew');
} else {
  console.log('Admin user already exists');
}

// Countries
const countryNames = ['China','Kenya','Tanzania','Uganda','Zambia','Zimbabwe'];
const countries = {};
for (const name of countryNames) {
  const c = await Country.findOneAndUpdate({ name }, { name }, { upsert: true, new: true });
  countries[name] = c;
}

// Products
const productDefs = [
  { name: 'EMS Foot Massager', sku: 'EMS-FOOT-001', costFromChina: 7, shippingToKenya: 3, profitTarget: 15, adBudget: 500 },
  { name: 'Portable Water Dental Floss', sku: 'WATER-FLOSS-002', costFromChina: 8, shippingToKenya: 2.5, profitTarget: 18, adBudget: 400 },
  { name: 'Tap Water Filter', sku: 'FILTER-003', costFromChina: 5, shippingToKenya: 1.8, profitTarget: 12, adBudget: 350 }
];
const products = {};
for (const d of productDefs) {
  const p = await Product.findOneAndUpdate({ sku: d.sku }, d, { upsert: true, new: true });
  products[d.name] = p;
}

// Initial stock per country
await Stock.deleteMany({});
await Stock.insertMany([
  { product: products['EMS Foot Massager']._id, country: countries['Kenya']._id, qty: 120 },
  { product: products['EMS Foot Massager']._id, country: countries['Tanzania']._id, qty: 60 },
  { product: products['Portable Water Dental Floss']._id, country: countries['Kenya']._id, qty: 80 },
  { product: products['Tap Water Filter']._id, country: countries['Uganda']._id, qty: 50 },
]);

// Seed ad spend and daily delivered for last 8 days
const platforms = ['Facebook','TikTok','Google'];
const today = new Date();
for (let i=0;i<8;i++){
  const d = new Date(today.getTime() - i*24*60*60*1000);
  for (const pname of Object.keys(products)) {
    const p = products[pname];
    const c = countries['Kenya'];
    const amount = 50 + Math.round(Math.random()*50);
    await AdSpend.findOneAndUpdate(
      { date: d, country: c._id, platform: platforms[i % platforms.length], product: p._id },
      { $set: { amountUSD: amount } },
      { upsert: true }
    );
    await DailyDelivered.findOneAndUpdate(
      { date: d, country: c._id, product: p._id },
      { $set: { delivered: 5 + Math.round(Math.random()*15) } },
      { upsert: true }
    );
  }
}

// Seed shipments
await Shipment.deleteMany({});
await Shipment.insertMany([
  { type: 'CN-KE', sourceCountry: countries['China']._id, destCountry: countries['Kenya']._id, product: products['EMS Foot Massager']._id, qty: 300, shippingCostUSD: 200, status: 'in_transit' },
  { type: 'OTHER', sourceCountry: countries['Kenya']._id, destCountry: countries['Tanzania']._id, product: products['Portable Water Dental Floss']._id, qty: 100, shippingCostUSD: 50, status: 'in_transit' }
]);

// Seed remittances
await Remittance.deleteMany({});
await Remittance.insertMany([
  { date: new Date(), product: products['EMS Foot Massager']._id, country: countries['Kenya']._id, orders: 100, pieces: 95, revenueUSD: 2850, adCostUSD: 700, deliveryCostsUSD: 300, profitUSD: 2850 - (700+300 + (95*(7+3))) },
  { date: new Date(), product: products['Portable Water Dental Floss']._id, country: countries['Kenya']._id, orders: 60, pieces: 58, revenueUSD: 2030, adCostUSD: 480, deliveryCostsUSD: 200, profitUSD: 2030 - (480+200 + (58*(8+2.5))) }
]);

console.log('Seed complete.');
process.exit(0);
