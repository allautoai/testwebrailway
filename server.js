const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection (optional - Railway will provide DATABASE_URL)
let db;
if (process.env.DATABASE_URL) {
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  
  // Create table on startup
  db.query(`
    CREATE TABLE IF NOT EXISTS email_checks (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      is_valid BOOLEAN NOT NULL,
      checked_at TIMESTAMP DEFAULT NOW()
    )
  `).then(() => {
    console.log('✅ Database table ready');
  }).catch(err => {
    console.log('⚠️  Database not available:', err.message);
  });
}

// Email validation function
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const commonTypos = {
    'gmial.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'yahhoo.com': 'yahoo.com',
    'hotmial.com': 'hotmail.com',
    'outlok.com': 'outlook.com'
  };
  
  const isValid = emailRegex.test(email);
  const domain = email.split('@')[1];
  const suggestion = commonTypos[domain] ? email.replace(domain, commonTypos[domain]) : null;
  
  return {
    email,
    isValid,
    suggestion,
    checks: {
      syntax: emailRegex.test(email),
      hasAt: email.includes('@'),
      hasDomain: email.split('@').length === 2,
      validDomain: domain ? domain.includes('.') : false
    }
  };
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: db ? 'connected' : 'not configured'
  });
});

// Validate single email
app.post('/api/validate', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  const result = validateEmail(email);
  
  // Save to database if available
  if (db) {
    try {
      await db.query(
        'INSERT INTO email_checks (email, is_valid) VALUES ($1, $2)',
        [email, result.isValid]
      );
    } catch (err) {
      console.log('Database insert failed:', err.message);
    }
  }
  
  res.json(result);
});

// Validate multiple emails
app.post('/api/validate-bulk', async (req, res) => {
  const { emails } = req.body;
  
  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'Emails array is required' });
  }
  
  const results = emails.map(email => validateEmail(email));
  
  const stats = {
    total: results.length,
    valid: results.filter(r => r.isValid).length,
    invalid: results.filter(r => !r.isValid).length,
    withSuggestions: results.filter(r => r.suggestion).length
  };
  
  res.json({ results, stats });
});

// Get recent checks (if database available)
app.get('/api/history', async (req, res) => {
  if (!db) {
    return res.json({ message: 'Database not configured', checks: [] });
  }
  
  try {
    const result = await db.query(
      'SELECT * FROM email_checks ORDER BY checked_at DESC LIMIT 50'
    );
    res.json({ checks: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
  if (!db) {
    return res.json({ message: 'Database not configured' });
  }
  
  try {
    const totalResult = await db.query('SELECT COUNT(*) FROM email_checks');
    const validResult = await db.query('SELECT COUNT(*) FROM email_checks WHERE is_valid = true');
    
    res.json({
      totalChecks: parseInt(totalResult.rows[0].count),
      validEmails: parseInt(validResult.rows[0].count),
      invalidEmails: parseInt(totalResult.rows[0].count) - parseInt(validResult.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
🚀 Server running on port ${PORT}
📝 API endpoints:
   POST /api/validate - Validate single email
   POST /api/validate-bulk - Validate multiple emails
   GET  /api/history - Get recent checks
   GET  /api/stats - Get statistics
   GET  /api/health - Health check
   
🌐 Open http://localhost:${PORT} to test
  `);
});
