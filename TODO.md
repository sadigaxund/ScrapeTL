NOTE: If you are AI, do not read this file, it is only for human reference.

5. replace frontend with more maintainble framework
6. AI html scraping that detects schema

---
"an sqlite integration where I can provide all the connection parameters, as well as, the schema and table and whatever is needed to save the data. Also I want you implement the "

20. investigate why is there 2 retries when i manually ran the scraper, it should be applied only to the integration, where if and only if after the message is scraped, it retries the message sending process not the scraping process, which has to be idempotent unless stated otherwise.[NOT SURE]
14. rework the integration part to be similar to scraper/schedules creation part, but where at the top  [NOT SURE]
26. Rename Schedules to Routines[NOT SURE]
36. reverse the sort of scrapers list, so that new scraper starts on top [NOTSURE]
37. add validation [NOTSURE] since you can just add comparator functions
38. when running the app a cmd argument to set a location logs, maybe in the future, being able to push into kafka or whatever
32. Quality of like change, ability to rearrange ports on added nodes [NOTSURE]
41. feature to fuzzy search variable when lazy something like: instead of  URLs.SOME_URL we could have *.SOME_URL, which will find first match or whatever [NOTSURE]

11. Implement USERS, PROJECTS, PERMISSIONS, SANDBOX/TEST/DEV MODE
33. scraper connected dashboard
35. add an external api access to run or overall control the scraper like (1) start (2) stop (3) create/delete/pause schedule (4) list all schedules/scrapers/integrations (5) get status of each scraper/schedule/integration (6) and etc...

7. schema registry -- 36. add schema to the context registry -- 28. add return types to the functions, also dont forget to display the types in the pick modal

2. more integrations: SQL: sqlite, postgres, microsoft sql server, mysql
13. ability to import module not just single script file. and make sure to save properly. this also allows separation of input as a separate config file.
19. When a scraper contains some new library thats not in the app's environment, scraper does not run, maybe a way of dynamically installing libraries.

31. ability to Select which fields to send to integrations.


34. implement a markdown wiki per scraper as means of documentation.


36 FIX: when there is no output but a debug, i cant extend the log

39. a node that negates the bool

40. a node that download image from URL, also has error port if cant

41. a way to raise Skip error to skip from certain point in the flow, hard cut.

44. find all of the dropdown elements, and properly standardize and make single reusable element

45. a possibilty to connect two scrapers, the output of the initial scraper should be passed to the next one, and either forced to create multiple input parameter nodes that match the schema of previous scrapers output schema, or using expression language to dynamically access.


47. playwright install appeared but no error thrown in the UI, see logs:
[TaskRegistry] Registering task 1
INFO:     127.0.0.1:54742 - "POST /api/run/2 HTTP/1.1" 200 OK
[BuilderEngine] Launching local browser (headless=True)
[BuilderEngine] Playwright setup failed: BrowserType.launch: Executable doesn't exist at /home/sakhund/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell
[BuilderEngine] Executing 1777057963954 (Resolved Type: 'input_external')
[BuilderEngine] Ran node 1777057963954 (input) -> result type: str
[BuilderEngine] Executing 1777058011398 (Resolved Type: 'source_fetch_playwright')
[BuilderEngine] Active Namespaces: ['ABC']
[BuilderEngine] ❌ Error in node 1777058011398 (source): BrowserType.launch: Executable doesn't exist at /home/sakhund/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     playwright install                                     ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
[Runner] StackOverflow Listings - Success but no data. Skipping integrations.
[TaskRegistry] Unregistering task 1

48. Making wireless dongle node, where I can click to add a source dongle that i stick into some port that I want to make wireless, then I click on that connected dongle to generate output dongles of that specific connection, and it should visually indicate that. So, that i can sometimes reduce the unnecessary connection duplications 

49. automatic reference updates, that is if I have something like {{ABC.SCRAPEABLE_PAGES}} within a certain scraper, and then i rename ABC to whatever, it should automatically update all instances of ABC to whatever.
50. Too much flattening

52. display passed parameters within logs entries, similarly how the schedule menu display it, but must match the overall design of log entries. However, be careful of BATCH type, so that it wont fill whole screen, maybe abbreviate the BATCH type into {...} the same way it's done in context registry, make sure to reuse the same elements, so that later i dont have to keep track of it where i used them.
53. implement import and export of a flow. which means it should also contain coordinates and parameters.


12. [TEST]somehow integrate an ability to connect playwright server, and pass it down to the scrapers to utilize. Make sure to display within queue and logs. Also, it opens a path to group and add delay by URL/domain 
32. [TEST] create same named variables in context registry, function input, function name, namespace itself, and scraper externam input to see if the names collide
36. [TEST] the changes that were made to split JSON type from BATCH type broke the way output is getting combined. Initially i intended to trigger the downstream flow coming out of BSoup node per html element if multiple were passed due to mode='all', however, this time at the end the system output node collects them all and treats them as a JSON object thus outputting this as a columnar fashion, instead of spreading and combining outputs into csv like output as we have implemented before this change.