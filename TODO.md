NOTE: If you are AI, do not read this file, it is only for human reference.

6. AI html scraping that detects schema

---
"an sqlite integration where I can provide all the connection parameters, as well as, the schema and table and whatever is needed to save the data. Also I want you implement the "

20. investigate why is there 2 retries when i manually ran the scraper, it should be applied only to the integration, where if and only if after the message is scraped, it retries the message sending process not the scraping process, which has to be idempotent unless stated otherwise.[NOT SURE]
14. rework the integration part to be similar to scraper/schedules creation part, but where at the top  [NOT SURE]
26. Rename Schedules to Routines[NOT SURE]
36. reverse the sort of scrapers list, so that new scraper starts on top [NOTSURE]
37. add validation [NOTSURE] since you can just add comparator functions
38. when running the app a cmd argument to set a location logs, maybe in the future, being able to push into kafka or whatever

11. Implement USERS, PROJECTS, PERMISSIONS, SANDBOX/TEST/DEV MODE
33. scraper connected dashboard
35. add an external api access to run or overall control the scraper like (1) start (2) stop (3) create/delete/pause schedule (4) list all schedules/scrapers/integrations (5) get status of each scraper/schedule/integration (6) and etc...
7. schema registry -- 36. add schema to the context registry -- 28. add return types to the functions, also dont forget to display the types in the pick modal

44. llm patch/grammar/apply logic for scraping. More specifically, websites sometimes change, sometimes frequently, we don't want to edit a scraper every week. What I want is that, when creating a scraper we have a certain flow file, we pass that with the proper grammar, and in/output structure. As well as, the error, for example, if a certain html element was not found maybe due to change in CSS selector class or whatever, the llm should be able to properly identify the problem, and create a necessary change to the flow using all the syntax and context provided to it. In a sense, making it self-sustaining. We could have auto-apply mode, user-approved or whatever.


2. more integrations: SQL: sqlite, postgres, microsoft sql server, mysql
13. ability to import module not just single script file. and make sure to save properly. this also allows separation of input as a separate config file.
19. When a scraper contains some new library thats not in the app's environment, scraper does not run, maybe a way of dynamically installing libraries.
31. ability to Select which fields to send to integrations.



45. a possibilty to connect two scrapers, the output of the initial scraper should be passed to the next one, and either forced to create multiple input parameter nodes that match the schema of previous scrapers output schema, or using expression language to dynamically access.


46. There are some numerical input fields with up and down arrows, where the context registry button {{}} on hover does not appear, replace with proper input field, no need for arrows, just standardize them into the same one.

47. string format node: the parameters start from 0 like this '{0}_{1}', however the ports are starting from 1. This should be synced.
48. mathemtical node that can manipulate the numerical data

44. [PENDING] find all of the dropdown elements, and properly standardize and make single reusable element

49. [PENDING] automatic reference updates, that is if I have something like {{ABC.SCRAPEABLE_PAGES}} within a certain scraper, and then i rename ABC to whatever, it should automatically update all instances of ABC to whatever.


12. [TEST]somehow integrate an ability to connect playwright server, and pass it down to the scrapers to utilize. Make sure to display within queue and logs. Also, it opens a path to group and add delay by URL/domain 