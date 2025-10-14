const fs = require('fs-extra');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');
const DATA_DIR = path.dirname(DATA_FILE);

class Database {
  constructor() {
    this.DATA_FILE = DATA_FILE;
    this.init();
  }

  init() {
    // Ensure data directory exists
    fs.ensureDirSync(DATA_DIR);
    
    // Initialize database if missing
    if (!fs.existsSync(DATA_FILE)) {
      console.log('🆕 Creating new database file...');
      const initialData = {
        system: {
          password: 'eastafricashop',
          version: '2.0.0',
          createdAt: new Date().toISOString()
        },
        business: {
          countries: ['china', 'kenya', 'tanzania', 'uganda', 'zambia', 'zimbabwe'],
          currencies: {
            china: 'USD',
            kenya: 'USD',
            tanzania: 'USD', 
            uganda: 'USD',
            zambia: 'USD',
            zimbabwe: 'USD'
          }
        },
        products: [],
        inventory: {
          shipments: [],
          deliveries: [],
          stockLevels: {}
        },
        sales: {
          remittances: [],
          orders: []
        },
        marketing: {
          adSpend: [],
          influencers: [],
          influencerSpends: []
        },
        finance: {
          categories: {
            debit: ['Shipping', 'Advertising', 'Salaries', 'Office Costs', 'Taxes'],
            credit: ['Product Sales', 'Other Income']
          },
          entries: []
        },
        systemData: {
          snapshots: [],
          todos: [],
          weeklyTodos: {}
        }
      };
      
      this.save(initialData);
      console.log('✅ Database created successfully');
    } else {
      console.log('📁 Database file exists');
    }
  }

  load() {
    try {
      if (!fs.existsSync(DATA_FILE)) {
        this.init();
      }
      return fs.readJsonSync(DATA_FILE);
    } catch (error) {
      console.error('❌ Database load error:', error);
      // Return empty structure if file is corrupted
      return {
        products: [],
        business: { countries: [] },
        marketing: { adSpend: [] },
        inventory: { shipments: [] },
        sales: { remittances: [] },
        finance: { entries: [], categories: { debit: [], credit: [] } },
        systemData: { snapshots: [] }
      };
    }
  }

  save(data) {
    try {
      fs.writeJsonSync(DATA_FILE, data, { spaces: 2 });
      return true;
    } catch (error) {
      console.error('❌ Database save error:', error);
      return false;
    }
  }

  // Helper methods
  getProducts() {
    const data = this.load();
    return data.products || [];
  }

  getShipments() {
    const data = this.load();
    return data.inventory?.shipments || [];
  }

  getRemittances() {
    const data = this.load();
    return data.sales?.remittances || [];
  }

  getAdSpend() {
    const data = this.load();
    return data.marketing?.adSpend || [];
  }

  update(updates) {
    const data = this.load();
    const updated = { ...data, ...updates };
    return this.save(updated);
  }
}

module.exports = new Database();
