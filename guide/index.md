# ALwith U Guide

ALwith U is an independent desktop client powered by Codex CLI. Use it to work with an AI assistant, organize conversations by project, and inspect files alongside your chat. It is not affiliated with or endorsed by OpenAI.

## Start here

### Essentials
1. Open ALwith U and sign in to your ALwith account.
2. Open your account menu at the bottom of the sidebar and choose **Settings**. Configure Codex or a model provider in the provider settings.
3. Start a new chat with the **+** button. Choose a project folder when the task involves local files.
4. Choose a model in the message composer, describe your goal, and send your message.
5. Review the response, requested permissions, and file changes before continuing.

Your ALwith account and model access are separate. Signing in to ALwith does not automatically sign you in to Codex or supply another provider's API key. ALwith U and ALwith Desktop keep separate ALwith login sessions.

Try a concrete first task: “Read this project's README and explain how to run it. Do not change files.” For a change request, include the intended result and how you want it verified.

### Prepare your first session

Before you send anything, check three items:

| Check | Where to look | What you want to see |
| --- | --- | --- |
| Account | Bottom-left account menu | Your ALwith account is signed in. |
| Model access | Settings, then provider configuration | A usable Codex login or configured provider. |
| Project context | Conversation header and folder selection | The folder you actually want to work on. |

Start with a reading task. It lets you check the connection and understand the project without introducing edits.

### A first task you can verify

Send this request in a project chat:

> Read the README and package configuration. Explain what this project does, which command starts it, and which checks are available. Do not change files. Cite the files that support your answer.

When the response arrives, open the referenced files in the workspace. Compare its instructions with the source. If the assistant says it ran a command, expand the activity and inspect the result.

Then ask a follow-up:

> Which of these instructions did you verify by running them? List anything you could not verify and explain why.

You have finished this exercise when you can identify the project, the chosen model, the supporting files, and the difference between advice and an executed check.

## Find your way around

### Essentials
The left sidebar contains plugins, extensions, Vibemon, and your conversations. The chat, activity, and cloud icons switch the sidebar's content; cloud features appear when available for your account.

- **Search:** find conversations and available commands.
- **Window icon:** open the separate chat window.
- **+ button:** start a new conversation.
- **Project groups:** expand a folder to find its conversations.
- **Sidebar toggle:** pin or collapse the navigation panel. When unpinned, hovering near its edge can preview it.
- **Account menu:** open settings, manage the pet, or sign out.
- **Question-mark button:** open this guide directly. Opening it again brings the existing guide window forward.

The guide ships with the application. Its content can be read without accessing an external documentation website.

### Read the workspace from left to right

| Area | Purpose | Typical action |
| --- | --- | --- |
| Navigation sidebar | Choose a conversation or application feature. | Expand a project and select a chat. |
| Conversation | Describe work and review the assistant's progress. | Read the response or expand tool activity. |
| Composer | Prepare the next request and choose its model. | Add context, select a model, and send. |
| File workspace | Inspect the source and resulting artifacts. | Select a file to preview or edit. |
| Bottom status area | Inspect cloud and version information. | Check a transfer problem or record the client version. |

The interface map on the guide home page is a schematic illustration. Its buttons open the relevant guide chapters; they do not execute a task in your actual conversation.

### Switch context deliberately

Selecting a conversation changes the conversation you are viewing. Starting a new chat creates a fresh context for a new task. Selecting another project should be followed by checking its folder before you request file operations.

For a focused reading session, collapse the sidebar or adjust the file area. Reopen the sidebar to navigate. The separate chat window is useful when you want the conversation visible beside another application.

### A quick orientation exercise

1. Find the search button at the top of the sidebar.
2. Locate a project's conversation group and expand it.
3. Open a conversation and identify its project folder.
4. Open a file from the workspace and compare it with the chat response.
5. Open the account menu, then return to this guide using the question-mark button.

## Chat and review work

### Essentials
Describe the task, relevant files, constraints, and acceptance criteria. You can attach supported files or images from the composer. Check the selected project and model before sending.

Responses can include explanations, tool activity, file links, and requests for approval. Expand activity details when you need to understand what the assistant did. If a permission request appears, read the proposed operation before accepting or rejecting it.

Use the stop control to interrupt a running turn. A stopped turn may already have made changes, so inspect the files before trying again. If an error appears, keep its text and check whether the task partially completed before resending.

The conversation menu provides the actions available for that conversation, including history management. Use a new chat for an unrelated task; keep related follow-up questions in the same conversation so the assistant has the context.

Codex manages conversation history. ALwith U displays that history rather than maintaining a separate copy. Signing out of ALwith U only clears this application's ALwith login; it is not a history-deletion command.

### Give the assistant a usable brief

A strong request includes the outcome, relevant context, constraints, and a way to check the result. You do not need a long specification for a small task, but the result should be observable.

> Update the empty-state text in the file panel so it explains what to select next. Follow the existing UI style. Keep the change limited to this flow, and run the relevant checks. Report what changed and anything you did not verify.

For exploratory work, state the boundary explicitly:

> Find the cause of this error and explain the failure chain. Read the relevant logs and source files. Do not modify files yet.

### Follow a running turn

1. Read the activity summary to see whether work is still running.
2. Expand tool activity when you need the command, files, or error details.
3. Review any permission request before responding to it.
4. Wait for the completed response before treating the turn as finished.
5. Inspect the resulting files and checks.

Accepting a permission request allows the proposed action to proceed. It does not mean the action has completed successfully.

### Review a result before continuing

Ask these questions after a change:

- Does the result match the original request?
- Which files changed, and are they all relevant?
- Which checks ran, and what did their output show?
- Were any operations interrupted or partially completed?
- What still needs a manual check in the application?

If the answer misses the goal, give a specific correction in the same conversation. For example: “The button opens a menu, but I asked it to open the guide directly. Keep the existing button placement and change that action.”

## Choose a model

### Essentials
Open **Settings** from the account menu to configure model access. Codex authentication and third-party provider credentials are separate from your ALwith login.

Configured provider models appear in the chat's model picker under their provider group. Select a model for the conversation that should use it. Configuring a provider does not switch every conversation to that provider.

For a custom provider, use the endpoint, API key, and model ID supplied by that provider. ALwith U's provider gateway expects Responses API compatibility; a service that only supports a different API format may not work.

Reasoning-effort options depend on the selected model. A higher effort can change response time and usage; it does not guarantee a correct answer. Available models and controls may differ by provider and account.

If a model fails, verify the endpoint, credentials, model ID, quota, and provider availability. Never include API keys in screenshots, shared conversations, or bug reports.

### Configure access step by step

1. Open the account menu and choose **Settings**.
2. Open the provider section.
3. Configure the access method you intend to use: Codex authentication or a supported third-party provider.
4. For an API provider, check the base URL, credential, and model identifier against that provider's configuration.
5. Return to the conversation and select a model in the composer.
6. Send a short reading or explanation task to confirm that access works.

Do not use your ALwith password as an API key. The accounts serve different purposes.

### Understand the model picker

A provider group tells you which service supplies the model. The model name identifies the model requested for that conversation. Reasoning controls appear only when available for the selected model.

When comparing models, use the same small task and check the resulting behavior. Record the selected provider and model so a later error report can be reproduced. A shorter answer, a faster response, and a more accurate response are different outcomes.

### Diagnose a provider error

| Symptom | Check first |
| --- | --- |
| Authentication is rejected | API key or Codex login validity. |
| Model is not found | Exact model ID and account access. |
| Request format is rejected | Responses API compatibility and base URL. |
| Rate limit or quota error | Provider quota, usage limits, and current load. |
| Connection timeout | Network access and provider availability. |

Change one configuration item at a time, then retry a simple request. This makes it easier to identify which change resolved the problem.

## Work with project files

### Essentials
Choose the folder that contains the files you want the assistant to work on. Confirm the project shown in the conversation before asking it to read or edit local files.

Open the file workspace to inspect the project tree, select a file, and view its preview or editor. Supported file types use the shared file-viewing and editing components; available controls depend on the selected file. Use the workspace controls to show or hide panes and adjust the space available for chat and files.

Save edits made in the editor and inspect any reported save failure. Before asking the assistant to continue, make sure it is working with the version of the file you intend.

Review diffs and the resulting files after an editing task. Ask the assistant which checks it actually ran. A successful response is not evidence that every test passed, and a preview is not a backup.

### Inspect before editing

1. Confirm the project folder in the conversation.
2. Expand the corresponding folders in the file tree.
3. Select the file you want to inspect.
4. Use its available preview or editor controls.
5. Ask the assistant to explain the file before requesting a change if its role is unclear.

For a large project, identify specific files or subdirectories in the request. This helps keep the work relevant and makes review easier.

### Use chat and files together

A useful pattern is to keep the response and the file visible together. Read the explanation, inspect the referenced source, and check whether the proposed change fits the surrounding code or content.

For documents and artifacts, compare the saved file with its preview. Some formats provide rich previews, while others provide a text editor or an unsupported-type message. Use the controls available for the selected file rather than assuming every format can be edited in the same way.

### Ask for a controlled change

> In this project, update the guide button so one click opens the local guide. Preserve the account menu behavior. Check the repeated-click and failure paths, then report the files changed and the checks that actually ran.

Review both the expected result and adjacent behavior. A button that opens correctly once may still behave incorrectly on repeated clicks or after a failed open.

### Save and hand off

Save manual editor changes before asking the assistant to inspect the updated version. If saving fails, preserve your text and resolve the error first. For a handoff, ask for a concise summary of the result, modified files, verification, and remaining issues.

## Plugins and extensions

### Essentials
**Plugins** exposes the skills and plugins available through Codex. Use the catalog and installed-item controls to inspect and manage what is available. A skill supplies reusable instructions; a plugin may provide additional tools and resources.

**Extensions** manages ALwith application extensions. These can add application surfaces or integrations and are separate from Codex plugins. Check the extension's description and requested access before enabling it.

Availability depends on installed components and account access. If an item does not appear, check its installation and enabled state, and read any startup error before reinstalling it.

### Choose the right entry

| Entry | What it manages | What to inspect |
| --- | --- | --- |
| Plugins | Codex skills and plugins from its catalogs. | Instructions, tools, installation state, and requirements. |
| Extensions | ALwith application integrations and added surfaces. | Enabled state, configuration, and requested access. |

Use the item's own description to decide whether it fits your task. Installing something does not guarantee that every conversation can use it; credentials, availability, and the item's instructions may still matter.

### Verify a new integration

1. Read its description and requirements.
2. Install or enable it using the available controls.
3. Complete any required configuration.
4. Test a small task that clearly requires its capability.
5. Inspect startup diagnostics if the expected tool or surface does not appear.

For example, a skill that supplies writing instructions may affect how the assistant approaches a task without adding a new application panel. An application extension may add a panel without becoming a Codex skill.

### When an integration stops working

Record the item's name, enabled state, error text, and the task that triggered the problem. Check configuration and startup diagnostics before reinstalling. If you disable an item to investigate, verify whether the original task can still be completed without it.

## Cloud files and Vibemon

### Essentials
Cloud features appear when enabled and available to your account. Use the cloud sidebar and status entry to inspect synchronization and transfer failures. A local edit and a completed upload are different events: check the status before assuming a file is available elsewhere.

If synchronization fails, inspect the affected item and its error, confirm connectivity and account access, and retry through the available controls. Keep a local copy of important work while resolving a transfer problem.

Vibemon provides the pet experience associated with your ALwith account. Open **Vibemon** from the sidebar to see the available options. Use the account menu to enable or disable the pet.

### Check a transfer from beginning to end

1. Make or save the local change.
2. Open the cloud status entry to inspect current transfers.
3. Read any failed item and its error.
4. Resolve the reported access, connectivity, or transfer issue.
5. Confirm the expected synchronized result before sharing or relying on the remote copy.

A file being visible in the local workspace does not prove that its newest version has uploaded. Use transfer status to distinguish local work from synchronized work.

### Resolve a failed item carefully

Keep the local content while investigating. Check whether the failure concerns a single file, a library, or the overall connection. Retry through the available controls after addressing the reported cause. If the failure repeats, record the file or library involved and the exact error without sharing private content.

### Manage the companion

Open **Vibemon** to browse the experience available to your account. The account menu's pet control enables or disables the companion. This setting is separate from model access and conversation history.

If the companion is unavailable, check ALwith account access and any error displayed in its own interface. Changing a conversation's model is not a pet-account configuration step.

## Settings and shortcuts

### Essentials
Use **Settings** to configure appearance, general behavior, the editor, account access, providers, extensions, and cloud features where available. Application appearance and model configuration are separate settings.

| Action | macOS | Windows |
| --- | --- | --- |
| Search chats and commands | Command + K | Ctrl + K |
| New chat | Command + N | Ctrl + N |

Button tooltips show relevant shortcuts. The bottom-right terminal icon displays application and Codex version information. When an update is ready, the update entry provides the restart action; save your work before restarting.

### Set up a comfortable workspace

| Settings area | Use it for |
| --- | --- |
| General | Application behavior and available general preferences. |
| Appearance | Theme and other appearance controls. |
| Editor | File-editor preferences. |
| Account | ALwith account information and access. |
| Provider | Codex or third-party model access. |
| Extensions | Application integration management. |
| Cloud | Cloud configuration when available. |
| About | Application information. |

Use the setting's label and explanation to understand its scope. Adjusting appearance changes how the application looks; selecting a model changes how that conversation's request is served.

### Learn shortcuts as you work

Start with search and new chat. Button tooltips show the corresponding platform shortcut. Use search to find a conversation rather than scanning every project group manually.

When troubleshooting a keyboard action, check which field or panel has focus. A shortcut pressed inside an editor can have a different context from an action in the main conversation.

### Keep version information with your report

Open the bottom-right terminal icon to inspect the application and Codex versions. Record both when reporting a model or conversation problem. Before restarting for an update, save manual edits and check whether an active task has already changed files.

## Troubleshooting

### Essentials
**I signed in, but cannot send a message.** Check model access in settings. ALwith sign-in and model-provider authentication are separate. Read the connection error and confirm a usable model is selected.

**A response is empty, interrupted, or failed.** Check the selected provider and the conversation's activity or error details. Verify connectivity, account quota, and model configuration. Do not assume the reasoning-effort setting is the cause. Check for partial changes before retrying a task that writes files.

**The assistant is working in the wrong folder.** Check the conversation's project folder. Start a chat in the intended project and explicitly identify the files to use.

**A file does not open or an edit does not save.** Verify that the file still exists, that the application can access its location, and that its type supports the requested operation. Preserve unsaved text before closing the editor.

**A plugin or extension is unavailable.** Verify that it is installed and enabled. Read its startup diagnostics and confirm any required credentials or dependencies.

**I need to report a problem.** Record the application and Codex versions, operating system, selected provider and model, steps to reproduce, expected behavior, actual behavior, and the exact error. Remove credentials and private file contents before sharing logs or screenshots.

### Use a repeatable diagnostic sequence

1. Record the exact action that failed.
2. State what you expected and what appeared instead.
3. Capture the visible error and relevant activity details.
4. Check the selected account, project folder, provider, and model.
5. Inspect whether the operation partially completed.
6. Change one relevant condition and retry a small task.

Avoid repeating a file-writing request until you know whether the previous attempt already wrote part of the result.

### Separate the layers

| Problem area | Useful evidence |
| --- | --- |
| ALwith sign-in | Login error and account state. |
| Model access | Provider, model, authentication error, and quota message. |
| Conversation execution | Tool activity, permission response, and turn error. |
| File work | File location, editor or preview error, and save result. |
| Cloud transfer | Failed item and synchronization status. |
| Integration | Item name, configuration, and startup diagnostics. |

An error in one area does not automatically identify a problem in another. For example, a cloud-transfer failure does not by itself explain why a model request was rejected.

### Copy this bug-report template

```text
Application version:
Codex version:
Operating system:
Provider and model:
Project or file involved (remove private details):
Steps to reproduce:
Expected result:
Actual result:
Exact error:
What completed before the failure:
Checks already tried:
```

Include a screenshot when it makes the result clearer. Remove credentials, private messages, and sensitive file contents before sharing it.
