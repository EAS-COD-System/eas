# EAS MongoDB Schema Reference

This document outlines all MongoDB collections and their fields used by the EAS Admin System.

---

## Collections Overview

### 1. users
| Field | Type | Description |
|-------|------|-------------|
| _id | ObjectId | Primary key |
| username | String | "eas" |
| password | String | Hashed password |
| role | String | "admin" |
| createdAt | Date | Timestamp |

### 2. products
| Field | Type | Description |
|-------|------|-------------|
| name | String | Product name |
| sku | String | SKU code |
| costFromChina | Number | Purchase price |
| shippingToKenya | Number | Cost to Kenya |
| profitTarget | Number | Target profit |
| adBudget | Number | Advertising budget |
| paused | Boolean | If true, excluded from totals |

### 3. countries
| name | String | Country name |

### 4. stock
| product | ObjectId (ref: products) |
| country | ObjectId (ref: countries) |
| qty | Number | Quantity |

### 5. shipments
| type | String | "CN-KE" or "OTHER" |
| sourceCountry | ObjectId |
| destCountry | ObjectId |
| product | ObjectId |
| qty | Number |
| shippingCostUSD | Number |
| status | String | "in_transit" or "arrived" |
| createdAt | Date |
| arrivedAt | Date |

### 6. daily_delivered
| date | Date |
| country | ObjectId |
| product | ObjectId |
| delivered | Number |

### 7. ad_spends
| date | Date |
| country | ObjectId |
| product | ObjectId |
| platform | String | Facebook/TikTok/Google |
| amountUSD | Number |

### 8. remittances
| date | Date |
| product | ObjectId |
| country | ObjectId |
| orders | Number |
| pieces | Number |
| revenueUSD | Number |
| adCostUSD | Number |
| deliveryCostsUSD | Number |
| profitUSD | Number |

### 9. finance
| date | Date |
| name | String |
| amountUSD | Number |
| type | String | credit/debit |
| period | String (optional) | e.g. 2025-01 |

### 10. tasks
| text | String |
| done | Boolean |
| createdAt | Date |

### 11. weekly_tasks
| weekday | Number (0–6) |
| text | String |
| done | Boolean |
| createdAt | Date |

### 12. influencers
| name | String |
| handle | String |
| country | ObjectId |
| amountUSD | Number |
| product | ObjectId |
| date | Date |

### 13. snapshots
| date | Date |
| type | String | "10m", "1h", "24h", "3d" |
| data | Mixed | JSON dump |

---

## Index Recommendations

```js
db.products.createIndex({ sku: 1 });
db.shipments.createIndex({ product: 1 });
db.ad_spends.createIndex({ date: 1, country: 1, product: 1 });
db.remittances.createIndex({ date: 1, product: 1, country: 1 });
db.finance.createIndex({ date: 1, type: 1 });
db.tasks.createIndex({ done: 1 });
db.weekly_tasks.createIndex({ weekday: 1 });
db.snapshots.createIndex({ date: -1 });
```

---

## Relationships Summary

- **Product** ↔ **Stock**, **Shipments**, **AdSpends**, **Remittances**, **Influencers**
- **Country** ↔ **Stock**, **Shipments**, **AdSpends**, **Remittances**, **Influencers**
- **Finance**, **Tasks**, **WeeklyTasks**, **Snapshots** are standalone.
