const express = require('express');
const path = require('path');
const app = express();

// Serve static assets (CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));

// Home – selection page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Men's fragrance
app.get('/men', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'men.html'));
});

// Women's fragrance
app.get('/women', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'women.html'));
});

// Gift page
app.get('/gift', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gift.html'));
});

// Fallback for any undefined route → home
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AUDORA Luxury Fragrances — server running on port ${PORT}`);
});
