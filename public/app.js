/* =========================================================
   EAS Tracker 2.0 - Fixed Frontend Application
   ========================================================= */

// Utility Functions
const Q = (selector, root = document) => root.querySelector(selector);
const QA = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const fmt = (number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(number) || 0);
const todayISO = () => new Date().toISOString().split('T')[0];

// API Client - FIXED
class APIClient {
  constructor() {
    this.baseURL = '';
  }

  async request(endpoint, options = {}) {
    const config = {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, config);
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` };
        }
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API Error (${endpoint}):`, error);
      throw error;
    }
  }

  async get(endpoint) {
    return this.request(endpoint);
  }

  async post(endpoint, data) {
    return this.request(endpoint, { method: 'POST', body: data });
  }

  async put(endpoint, data) {
    return this.request(endpoint, { method: 'PUT', body: data });
  }

  async delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
}

// Application State
const state = {
  authenticated: false,
  products: [],
  countries: [],
  categories: { debit: [], credit: [] }
};

// Initialize API Client
const api = new APIClient();

// Authentication System
class AuthManager {
  constructor() {
    this.checkAuth();
  }

  async checkAuth() {
    try {
      const result = await api.get('/api/auth/check');
      state.authenticated = result.authenticated;
      this.updateUI();
      
      if (state.authenticated) {
        await app.init();
      }
    } catch (error) {
      state.authenticated = false;
      this.updateUI();
    }
  }

  async login(password) {
    try {
      const result = await api.post('/api/auth/login', { password });
      
      if (result.ok) {
        state.authenticated = true;
        this.updateUI();
        await app.init();
        return true;
      }
    } catch (error) {
      throw new Error(error.message || 'Login failed. Please check your password.');
    }
  }

  async logout() {
    try {
      await api.post('/api/auth/logout');
    } catch (error) {
      // Ignore logout errors
    } finally {
      state.authenticated = false;
      this.updateUI();
      window.location.reload();
    }
  }

  updateUI() {
    const loginScreen = Q('#login');
    const mainApp = Q('#main');
    
    if (state.authenticated) {
      loginScreen.classList.add('hide');
      mainApp.classList.remove('hide');
    } else {
      loginScreen.classList.remove('hide');
      mainApp.classList.add('hide');
    }
  }
}

// Main Application - FIXED
class EASApplication {
  constructor() {
    this.auth = new AuthManager();
    this.initialized = false;
  }

  async init() {
    if (!state.authenticated || this.initialized) return;

    try {
      console.log('🚀 Initializing EAS Tracker...');
      
      // Load initial data
      await this.loadInitialData();
      
      // Set up navigation
      this.initNavigation();
      
      // Set up event listeners
      this.initEventListeners();
      
      // Initialize forms
      this.initForms();
      
      this.initialized = true;
      console.log('✅ EAS Tracker initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize application:', error);
      this.showError('Failed to load application data: ' + error.message);
    }
  }

  async loadInitialData() {
    console.log('📥 Loading initial data...');
    
    try {
      const [meta, products, categories] = await Promise.all([
        api.get('/api/system/meta').catch(() => ({ countries: [] })),
        api.get('/api/products').catch(() => ({ products: [] })),
        api.get('/api/finance/categories').catch(() => ({ debit: [], credit: [] }))
      ]);

      state.countries = meta.countries || [];
      state.products = products.products || [];
      state.categories = categories;

      console.log('✅ Loaded:', {
        countries: state.countries.length,
        products: state.products.length,
        categories: state.categories
      });

      // Update UI with loaded data
      this.updateProductSelects();
      this.updateCountrySelects();
      
    } catch (error) {
      console.error('❌ Error loading initial data:', error);
      throw error;
    }
  }

  initNavigation() {
    console.log('🔧 Setting up navigation...');
    
    QA('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.showView(link.dataset.view);
      });
    });

    // Show initial view
    this.showView('dashboard');
  }

  initEventListeners() {
    console.log('🔧 Setting up event listeners...');
    
    // Logout button
    Q('#logoutBtn').addEventListener('click', () => {
      this.auth.logout();
    });

    // Quick action buttons
    QA('.action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        this.handleQuickAction(action);
      });
    });
  }

  initForms() {
    console.log('🔧 Initializing forms...');
    
    // Add Product Form - FIXED
    const addProductForm = Q('#addProductForm');
    if (addProductForm) {
      addProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.addProduct();
      });
    }

    // Edit Product Form
    const editProductForm = Q('#editProductForm');
    if (editProductForm) {
      editProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.updateProduct();
      });
    }

    // Edit product selection
    const editProductSelect = Q('#editProductSelect');
    if (editProductSelect) {
      editProductSelect.addEventListener('change', (e) => {
        this.loadProductForEdit(e.target.value);
      });
    }

    // Add Country Form
    const addCountryBtn = Q('#addCountryBtn');
    if (addCountryBtn) {
      addCountryBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.addCountry();
      });
    }

    console.log('✅ Forms initialized');
  }

  updateProductSelects() {
    const selects = QA('select[id$="Product"]');
    const activeProducts = state.products.filter(p => p.status === 'active');
    
    selects.forEach(select => {
      if (!select) return;
      
      if (select.id === 'editProductSelect') {
        // For edit form, include all products
        select.innerHTML = `
          <option value="">Choose a product...</option>
          ${state.products.map(p => `
            <option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}</option>
          `).join('')}
        `;
      } else {
        // For other forms, only active products
        select.innerHTML = `
          <option value="">Select Product</option>
          ${activeProducts.map(p => `
            <option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}</option>
          `).join('')}
        `;
      }
    });
  }

  updateCountrySelects() {
    const fromSelects = QA('#movementFrom, #adCountry');
    const toSelects = QA('#movementTo, #saleCountry');
    
    // From selects include China
    fromSelects.forEach(select => {
      if (!select) return;
      select.innerHTML = `
        <option value="">Select Source</option>
        <option value="china">China</option>
        ${state.countries.map(country => `
          <option value="${country}">${country.toUpperCase()}</option>
        `).join('')}
      `;
    });
    
    // To selects exclude China
    toSelects.forEach(select => {
      if (!select) return;
      select.innerHTML = `
        <option value="">Select Destination</option>
        ${state.countries.map(country => `
          <option value="${country}">${country.toUpperCase()}</option>
        `).join('')}
      `;
    });
  }

  showView(viewName) {
    console.log('👀 Showing view:', viewName);
    
    // Hide all views
    QA('.view-section').forEach(section => {
      section.classList.add('hide');
    });

    // Remove active class from all nav links
    QA('.nav-link').forEach(link => {
      link.classList.remove('active');
    });

    // Show selected view
    const targetView = Q(`#${viewName}`);
    if (targetView) {
      targetView.classList.remove('hide');
      
      // Activate corresponding nav link
      const navLink = Q(`[data-view="${viewName}"]`);
      if (navLink) {
        navLink.classList.add('active');
      }
    }
  }

  handleQuickAction(action) {
    console.log('⚡ Quick action:', action);
    switch (action) {
      case 'add-product':
        this.showView('products');
        break;
      case 'record-shipment':
        this.showView('inventory');
        break;
      case 'add-adspend':
        this.showView('inventory');
        break;
      case 'record-sale':
        this.showView('sales');
        break;
      case 'add-expense':
        this.showView('finance');
        break;
      case 'view-reports':
        this.showView('sales');
        break;
    }
  }

  // ADD PRODUCT - FIXED
  async addProduct() {
    const form = Q('#addProductForm');
    if (!form) return;

    const formData = new FormData(form);
    
    const product = {
      name: formData.get('productName') || '',
      sku: formData.get('productSku') || '',
      cost_china: parseFloat(formData.get('productCost')) || 0,
      ship_china_to_kenya: parseFloat(formData.get('productShipping')) || 0,
      margin_budget: parseFloat(formData.get('productMargin')) || 0
    };

    console.log('📦 Adding product:', product);

    // Validation
    if (!product.name.trim()) {
      this.showError('Product name is required');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding...';

      const result = await api.post('/api/products', product);
      
      if (result.ok) {
        this.showSuccess('Product added successfully');
        form.reset();
        
        // Reload products and update selects
        await this.loadInitialData();
      } else {
        throw new Error(result.error || 'Failed to add product');
      }
    } catch (error) {
      console.error('❌ Error adding product:', error);
      this.showError('Failed to add product: ' + error.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }

  // UPDATE PRODUCT
  async updateProduct() {
    const productId = Q('#editProductSelect').value;
    if (!productId) {
      this.showError('Please select a product to edit');
      return;
    }

    const form = Q('#editProductForm');
    const formData = new FormData(form);
    
    const updates = {
      name: formData.get('editProductName') || '',
      sku: formData.get('editProductSku') || '',
      cost_china: parseFloat(formData.get('editProductCost')) || 0,
      ship_china_to_kenya: parseFloat(formData.get('editProductShipping')) || 0,
      margin_budget: parseFloat(formData.get('editProductMargin')) || 0
    };

    // Validation
    if (!updates.name.trim()) {
      this.showError('Product name is required');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      const result = await api.put(`/api/products/${productId}`, updates);
      
      if (result.ok) {
        this.showSuccess('Product updated successfully');
        await this.loadInitialData();
      } else {
        throw new Error(result.error || 'Failed to update product');
      }
    } catch (error) {
      console.error('❌ Error updating product:', error);
      this.showError('Failed to update product: ' + error.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }

  loadProductForEdit(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    Q('#editProductName').value = product.name;
    Q('#editProductSku').value = product.sku || '';
    Q('#editProductCost').value = product.cost_china;
    Q('#editProductShipping').value = product.ship_china_to_kenya;
    Q('#editProductMargin').value = product.margin_budget;
  }

  // ADD COUNTRY
  async addCountry() {
    const countryInput = Q('#newCountry');
    const name = countryInput.value.trim();
    
    if (!name) {
      this.showError('Please enter a country name');
      return;
    }

    const button = Q('#addCountryBtn');
    const originalText = button.textContent;
    
    try {
      button.disabled = true;
      button.textContent = 'Adding...';

      const result = await api.post('/api/system/countries', { name });
      
      if (result.ok) {
        this.showSuccess('Country added successfully');
        countryInput.value = '';
        await this.loadInitialData();
      } else {
        throw new Error(result.error || 'Failed to add country');
      }
    } catch (error) {
      console.error('❌ Error adding country:', error);
      this.showError('Failed to add country: ' + error.message);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  showError(message) {
    alert('❌ Error: ' + message);
  }

  showSuccess(message) {
    alert('✅ ' + message);
  }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 EAS Tracker starting...');
  
  // Set up login form
  const loginForm = Q('#loginBtn');
  const passwordInput = Q('#passwordInput');
  
  if (loginForm && passwordInput) {
    loginForm.addEventListener('click', async () => {
      const password = passwordInput.value.trim();
      
      if (!password) {
        alert('Please enter your password');
        return;
      }

      loginForm.disabled = true;
      loginForm.textContent = 'Logging in...';

      try {
        await app.auth.login(password);
      } catch (error) {
        alert(error.message);
      } finally {
        loginForm.disabled = false;
        loginForm.textContent = 'Login';
        passwordInput.value = '';
        passwordInput.focus();
      }
    });

    // Allow login on Enter key
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        loginForm.click();
      }
    });
  }

  // Initialize app
  window.app = new EASApplication();
});

// Make app globally available for debugging
window.EASApp = {
  state,
  api,
  fmt,
  todayISO
};
