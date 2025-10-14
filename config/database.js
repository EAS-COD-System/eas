const fs = require('fs-extra');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');
const DATA_DIR = path.dirname(DATA_FILE);

class Database {
  constructor() {
    this.init();
  }

  init() {
    // Ensure data directory exists
    fs.ensureDirSync(DATA_DIR);
    
    // Initialize database if missing
    if (!fs.existsSync(DATA_FILE)) {
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
      console.log('🆕 Created new database with initial data');
    }
  }

  load() {
    try {
      return fs.readJsonSync(DATA_FILE);
    } catch (error) {
      console.error('❌ Database load error:', error);
      return null;
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
    return this.load().products || [];
  }

  getShipments() {
    return this.load().inventory.shipments || [];
  }

  getRemittances() {
    return this.load().sales.remittances || [];
  }

  getAdSpend() {
    return this.load().marketing.adSpend || [];
  }

  update(updates) {
    const data = this.load();
    const updated = { ...data, ...updates };
    return this.save(updated);
  }
}

module.exports = new Database();
