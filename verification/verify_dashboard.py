from playwright.sync_api import sync_playwright
import time

def verify(page):
    # Go to mobile dashboard
    page.goto("http://localhost:3000/mobile")

    # Wait for loading to finish
    try:
        page.wait_for_selector(".t-pending", timeout=5000) # Wait for a tip card
    except:
        print("Timeout waiting for tips, taking screenshot anyway")

    # Take screenshot
    page.screenshot(path="verification/dashboard_mobile_after_fix.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify(page)
        finally:
            browser.close()
