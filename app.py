from flask import Flask, render_template
from sqlalchemy import create_engine
from models import Base
app = Flask(__name__)
@app.route('/')
def index():
    return render_template('index.html', title='Dashboard')
@app.route('/products')
def products():
    return render_template('products.html', title='Products')
@app.route('/product/<sku>')
def product(sku):
    return render_template('product.html', title=sku)
if __name__=='__main__':
    app.run(debug=True)
