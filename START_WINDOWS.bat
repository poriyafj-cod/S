@echo off
chcp 65001 >nul
title CHAAM RetailOS
color 0E

echo.
echo  ══════════════════════════════════════════
echo     CHAAM RetailOS — راه اندازی
echo  ══════════════════════════════════════════
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo  [X] Python نصب نیست!
  echo      از python.org نسخه 3.10+ نصب کنید
  echo      هنگام نصب تیک "Add to PATH" را بزنید
  pause
  exit /b 1
)

echo  [1/2] بررسی کتابخانه‌ها...
python -c "import flask, flask_cors, openpyxl" 2>nul
if errorlevel 1 (
  echo        نصب کتابخانه‌ها...
  pip install flask flask-cors openpyxl --quiet
)
echo        OK
echo.
echo  [2/2] اجرای سرور...
echo.
python connector.py
pause
