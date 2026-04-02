# Fixed Bugs Log

## [2026-04-02] Discord Integration - Empty Results Data
**Description:** 
When the "Include Scraping Results" option was enabled in Discord integrations, only the execution state (Success/Failure) was being sent, even if data was successfully scraped.

**Root Cause:**
*   In `app/runner.py`, the `_fire_integrations` function was being called with an empty `episodes` list initialization instead of the `all_episodes` list that contained the actual scraped data.
*   In `app/discord.py`, the notification logic only processed the full data payload if the `episodes` argument was truthy. Since it received an empty list, it fell back to the state-only message.

**Fix:**
*   Updated `app/runner.py` to pass `all_episodes` to the integration dispatcher.
*   Refined `app/discord.py` to ensure consistent formatting between results and state messages.
*   Ensured the scraper's name is used as the title in all Discord notifications instead of the integration's internal configuration name.
*   Added thumbnails and footers to state messages for visual consistency.

**Impact:**
Discord notifications now correctly include full scraping data when configured, and the messages have a more professional and consistent layout.
