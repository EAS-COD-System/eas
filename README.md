
# EAS COD v16 (Render-ready)
Countries: Kenya (KE), Tanzania (TZ), Uganda (UG), Zambia (ZM), Zimbabwe (ZW). China (CN) included for supply routing.
- Dashboard: country totals, ad spend (daily), create movement, shipments (CN→KE + inter-country) with mark-arrived & editable shipping, daily delivered, remittance report with date range.
- Product: stock by country, profit snapshots by country & total, current daily spend per country+platform, shipments CRUD.
- White background + subtle section colors.

## Local run
pip install -r requirements.txt
python app.py

## Render
- Connect repo, create Web Service, Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn app:app --bind 0.0.0.0:$PORT`
