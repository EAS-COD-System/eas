const express = require('express');
const path = require('path');
const app = express();

// Serve static files (CSS, JS, images, and also .html directly if needed)
app.use(express.static(__dirname));

// Route /gift -> gift.html
app.get('/gift', (req, res) => {
  res.sendFile(path.join(__dirname, 'gift.html'));
});

// Route /women -> women.html
app.get('/women', (req, res) => {
  res.sendFile(path.join(__dirname, 'women.html'));
});

// Route /men -> men.html
app.get('/men', (req, res) => {
  res.sendFile(path.join(__dirname, 'men.html'));
});

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AUDORA server running on port ${PORT}`);
});
