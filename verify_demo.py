from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Get absolute path to docs/demo.html
        cwd = os.getcwd()
        file_path = f"file://{cwd}/docs/demo.html"

        print(f"Navigating to {file_path}")
        page.goto(file_path)

        # Check if video source is correct
        video_source = page.locator("video source").get_attribute("src")
        print(f"Video source: {video_source}")

        if "assets/demo.mp4" in video_source:
            print("SUCCESS: Video source is correct.")
        else:
            print("FAILURE: Video source is incorrect.")

        # Take screenshot
        os.makedirs("verification", exist_ok=True)
        screenshot_path = "verification/demo_page.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

if __name__ == "__main__":
    run()
