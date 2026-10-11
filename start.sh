#!/bin/bash
echo "══════════════════════════════════════════"
echo "   CHAAM RetailOS"
echo "══════════════════════════════════════════"
python3 -c "import flask, flask_cors, openpyxl" 2>/dev/null || \
  pip3 install flask flask-cors openpyxl --quiet
python3 connector.py
