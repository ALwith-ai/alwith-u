# ALwith U Guide

ALwith U is an independent desktop client powered by Codex CLI. Use it to work with an AI assistant, organize conversations by project, and inspect files alongside your chat. It is not affiliated with or endorsed by OpenAI.

## Start here

### Essentials
1. Open ALwith U and sign in to your ALwith account.
2. Open your account menu at the bottom of the sidebar and choose **Settings**. Configure Codex or a model provider in **Models**.
3. Start a new chat with the **+** button. Choose a project folder when the task involves local files.
4. Choose a model in the message composer, describe your goal, and send your message.
5. Review the response, requested permissions, and file changes before continuing.

Your ALwith account and model access are separate. Signing in to ALwith does not automatically sign you in to Codex or supply another provider's API key.

Try a concrete first task: “Read this project's README and explain how to run it. Do not change files.” For a change request, include the intended result and how you want it verified.

### Prepare your first session

Before you send anything, check three items:

| Check | Where to look | What you want to see |
| --- | --- | --- |
| Account | Bottom-left account menu | Your ALwith account is signed in. |
| Model access | Settings → Models | A usable Codex login or configured provider. |
| Project context | Conversation header and folder selection | The folder you actually want to work on. |

Start with a reading task. It lets you check the connection and understand the project without introducing edits.

### Confirm that setup works

Send a small reading request: “Read this project's README and explain how to run it. Do not change files. Cite your sources.” A working session returns a response, opens its file references, and shows any tool activity. If sending fails, use [Troubleshooting](alwith-docs://guide/troubleshooting) before starting a larger task.

## Find your way around

### Essentials
The left sidebar contains plugins, extensions, Vibémon, and your conversations. The chat, activity, collections, and cloud entries switch the sidebar's content; cloud features appear when available for your account.

- **Search:** find conversations and available commands.
- **Window icon:** open the separate chat window.
- **+ button:** start a new conversation.
- **Project groups:** expand a folder to find its conversations.
- **Sidebar toggle:** pin or collapse the navigation panel. When unpinned, hovering near its edge can preview it.
- **Account menu:** open settings, manage the vibemon, or sign out.
- **Question-mark button:** open the help menu, then choose **User guide**. Opening it again brings the existing guide window forward.

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

### Find a specific workflow

- [Manage conversations](alwith-docs://guide/sessions): search, rename, organize and delete chats.
- [Generate and edit images](alwith-docs://guide/images): image models, references and downloads.
- [Use voice](alwith-docs://guide/voice): dictation, automatic sending and voice calls.
- [Use your computer](alwith-docs://guide/computer): permissions, previews and reconnection.
- [Connect a phone](alwith-docs://guide/mobile): sign-in, pairing and trusted devices.
- [Import existing work](alwith-docs://guide/import): bring over supported setup and conversations.

## Import existing work

### Entry and prerequisites

Open **Settings → Import**. U can detect supported setup, projects and chat sessions from Claude Code and Cursor on this computer. A source must have importable local data; detection does not guarantee that every source feature can be transferred.

### Select and import

1. Choose **Import** beside the source application.
2. Wait for detection, then review the offered setup, projects and chats.
3. Select only the items you want and choose **Import selected**.
4. Keep U running while import proceeds. **Do it in background** closes the progress view without turning a running import into a completed one.
5. Inspect the success and failure counts and the entries in **Import history**.
6. Open an imported conversation or inspect the imported setup to confirm the result.

The selection screen identifies which types of settings or integrations were found. Imported configuration does not prove that provider credentials or external services are usable; verify them with a small task.

### Handle an incomplete import

If no importable setup is found, confirm that the source has local data on this computer, then use **Check again**. If only some items fail, inspect those failures and the already imported items before retrying. Preserve the original source data until you have verified the imported result.

## Chat and review work

### Essentials
Describe the task, relevant files, constraints, and acceptance criteria. You can attach supported files or images from the composer. Check the selected project and model before sending.

Responses can include explanations, tool activity, file links, and requests for approval. Expand activity details when you need to understand what the assistant did. If a permission request appears, read the proposed operation before accepting or rejecting it.

Use the stop control to interrupt a running turn. A stopped turn may already have made changes, so inspect the files before trying again. If an error appears, keep its text and check whether the task partially completed before resending.

The conversation menu provides actions such as rename, search and delete. See [Manage conversations](alwith-docs://guide/sessions) for their effects. Use a new chat for an unrelated task; keep related follow-up questions in the same conversation so the assistant has the context.

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

### Review the result

Open changed files and inspect the reported checks. Ask which checks ran, which failed and which were not attempted. Give corrections in the same conversation when they concern the same task; start a new chat for unrelated work.

For image creation, use [Images](alwith-docs://guide/images). For spoken requests, see [Voice](alwith-docs://guide/voice).

## Manage conversations

### Entry and prerequisites

Use the sidebar to select a project or conversation. Conversation actions apply to the chat displayed in that window. Rename and delete require a connected conversation that is not still restoring.

### Find and rename a chat

1. Use **Search** in the sidebar, or Command + K on macOS / Ctrl + K on Windows, to find a conversation.
2. Open the result and check its title and project folder.
3. Open the conversation's **More** menu and choose the rename action.
4. Enter the new title and confirm. Check that the title changes in the conversation and sidebar.

Use the conversation's search action to find text within that chat. This differs from searching for a conversation across the sidebar.

### Organize conversations in collections

Use a conversation's **Favorite** action to save it to a collection. Open **Collections** in the sidebar to find saved chats and create collections. Group actions let you organize their records.

Removing a chat from a collection, clearing a collection or deleting a collection keeps the conversation content and its records in other collections. These actions are different from deleting the conversation itself.

### Use a separate chat window

On a conversation with messages, use **Open chat window** to keep it beside another application. The floating window provides an action to return to the main window. A newly prepared empty chat or a conversation still restoring may not offer this action yet.

Check the chat title before sending a message in either window. Opening another window does not create a second independent conversation history.

### Delete deliberately

Open the conversation's **More** menu, choose delete, read the confirmation and confirm only for the intended chat. The conversation should disappear from the visible list. Do not use delete merely to remove a collection record or to close a window.

If an action fails, retain the error and check the conversation's actual state before repeating it. If search finds no result, check the query and whether you are searching inside one chat or across conversations.

## Choose a model

### Essentials
Open **Settings → Models** from the account menu to configure model access. Codex authentication and third-party provider credentials are separate from your ALwith login.

Configured provider models appear in the chat's model picker under their provider group. Select a model for the conversation that should use it. Configuring a provider does not switch every conversation to that provider.

For a custom provider, use the endpoint, API key, and model ID supplied by that provider. ALwith U's provider gateway expects Responses API compatibility; a service that only supports a different API format may not work.

Reasoning-effort options depend on the selected model. A higher effort can change response time and usage; it does not guarantee a correct answer. Available models and controls may differ by provider and account.

If a model fails, verify the endpoint, credentials, model ID, quota, and provider availability. Never include API keys in screenshots, shared conversations, or bug reports.

### Configure access step by step

1. Open the account menu and choose **Settings**.
2. Open **Models**.
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

### Choose or migrate a model

Keep the exact provider and model ID when following model-specific instructions. To change a conversation's model, configure that provider in Settings, then select the intended model in that conversation's picker. Other conversations retain their own selections. Compare the same representative task before relying on the new model for a larger job.

This offline guide does not contain live model prices, rankings, context limits or account entitlements. Use the selected provider's current official documentation for those facts.

## Generate and edit images

### Entry and prerequisites

Choose the image mode in the composer. Open **Settings → Images** to configure image access. ChatGPT Images uses the connected ChatGPT account; its **Manage account** button opens model-provider settings. Other image providers have their own saved credentials and connection settings.

The text model and the image model are different choices. A working text conversation does not prove that an image provider is configured. The image settings include a credential test that does not generate an image or spend generation credits; an actual generation can incur provider usage.

### Create an image

1. Start a chat and select image mode in the composer.
2. Select an available image model and its supported resolution.
3. Choose an aspect ratio, or leave it on **Auto**.
4. Describe the subject, composition, style and any exact text you want in the image.
5. Add reference images if the result should preserve an existing subject or design.
6. Send the request and wait for a generated image in the conversation.

For example: “Create a landscape illustration of a quiet mountain town at dawn, with warm window light and no text.” A completed text explanation alone is not a successful image result.

### Refine and save

Continue in the same conversation to refine the result. State what should stay and what should change. For an edit based on a particular picture, attach that picture or use the available image-edit controls so the reference is explicit.

Open a returned image to inspect it at a larger size. Its viewer offers editing and download controls; use **Download** to save a local copy and check the chosen destination. Editing controls may be unavailable while an image is loading, has failed to load or is being submitted.

The image viewer distinguishes prepared edits from immediate requests:

| Control | How to use it |
| --- | --- |
| Annotate | Mark the relevant area, add edit instructions and send the request. |
| Add comment | Click the image to place comments, save the comments and send when ready. |
| Erase | Paint over the area to remove, then send the request. |
| Remove background | Clicking it immediately submits a background-removal request. |
| Resize | Selecting an aspect ratio immediately submits an image-edit request. |

Use Undo, Redo or Cancel editing where offered before sending. These controls request an edited image; inspect the returned result and download the version you want to keep.

### Common problems

| Symptom | Action |
| --- | --- |
| Sending is disabled or image configuration is requested | Configure the selected image provider in Settings and check its saved credentials. |
| A reference is rejected | Check the displayed type, size and reference-count limits for the selected model. |
| The wrong subject was edited | Select the intended reference explicitly and describe what must be preserved. |
| Generation failed or was stopped | Inspect the conversation for a result before retrying. Stopping does not guarantee that the provider did no work or charged nothing. |

Provider availability and limits can change. This guide describes U's controls, not a guarantee of current provider pricing or entitlement.

## Use voice

### Entry and prerequisites

Open **Settings → Voice**, enable voice input, select a microphone and configure the speech-recognition service. Save the settings and allow microphone access when the operating system requests it. Voice controls appear in supported ordinary chat composers; image mode does not show these voice buttons.

### Choose how recognized speech is used

| Input mode | What happens |
| --- | --- |
| Dictation · edit before sending | Recognized text becomes a draft you can review and send yourself. |
| Send after a pause | A pause can finish recognition and submit the request automatically. |
| Hands-free · listen again after the reply | The conversation can resume listening after the assistant responds. |

Start with dictation if you want to review names, numbers and commands before sending. Send or clear an existing draft before using automatic send. Global and project hotwords help with specialized vocabulary; project hotwords apply to the configured project directory.

### Record a request

1. Open the intended conversation and check the selected input mode.
2. Click the microphone button and wait for recording to begin.
3. Speak, then use **Finish recording** when done. Automatic modes can finish after the configured pause.
4. In dictation mode, review the resulting draft before sending. In automatic modes, check that the intended request was submitted.
5. Use **Cancel voice input** to end the voice-input interaction when needed. Cancelling recording does not undo a request already sent.

In the active chat window, double-tap Option / Alt within 500 ms to start voice input; a single tap finishes recording. Follow the visible state and button tooltip when a voice interaction is already active.

### Start and end a voice call

The headphones button starts a **Voice call** when the connected conversation supports realtime voice. Wait for the connected state before speaking. Use **End voice call** to disconnect, or **Cancel voice connection** while it is connecting.

A voice call is separate from speech-to-text dictation. Enabling dictation or saving a recognition key does not guarantee realtime voice is available for every connection. If a voice interaction returns to chat, inspect any submitted request before starting another one.

### Common problems

If the microphone cannot connect, check system permission and the selected input device. If speech is not recognized, check the recognition service, credentials, microphone level and silence settings. If no voice button appears, check that voice is enabled and that the current composer supports it. Preserve the displayed error or request reference when reporting a failure.

## Work with project files

### Essentials
Choose the folder that contains the files you want the assistant to work on. Confirm the project shown in the conversation before asking it to read or edit local files.

Open the file workspace to inspect the project tree, select a file, and view its preview or editor. Available preview and editing controls depend on the selected file type. Use the workspace controls to show or hide panes and adjust the space available for chat and files.

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

### Save and hand off

Save manual editor changes before asking the assistant to inspect the updated version. If saving fails, preserve your text and resolve the error first. For a handoff, ask for a concise summary of the result, modified files, verification, and remaining issues.

### Local project files and cloud files

A project folder gives a conversation local file context. It does not automatically upload that whole project. Use [Cloud files](alwith-docs://guide/cloud-vibemon) for cloud libraries, sharing and transfer status. Check which location you are viewing before moving, deleting or sharing a file.

## Use your computer

### Entry and prerequisites

Open **Settings → Computer use**. This lets U conversations inspect the screen and operate local applications. The setting applies across conversations and forks; it is not limited to the selected chat.

1. Check the availability and permission status shown in the settings page.
2. On macOS, use **Request system permissions** for **Accessibility** and **Screen Recording**, then complete the operating system's prompts.
3. Return to U and enable computer use once the required permissions are allowed.
4. Wait for the connection status to show **Ready**.

If the page reports an unsupported platform or a missing component, follow that error instead of repeatedly toggling the switch.

### Request and observe an operation

Name the target application and desired result, for example: “Inspect the open document in this application and explain its structure without editing it.” The assistant should inspect the current application before acting.

Follow the computer preview and activity in the conversation. The preview can show the active application, queued work and available stop controls. A dispatched click is not proof that the intended screen appeared; the assistant should inspect the result before reporting success.

### Stop or reconnect

Use the preview's **Stop** or **Cancel queue** action for the relevant work. To revoke computer access across U, disable it in **Settings → Computer use**.

If tools disconnect, open the same settings page, read the connection and permission state, then choose **Reconnect**. Reconnection stops current computer actions and checks access again; it does not replay those actions. Once ready, send the request again, asking the assistant to inspect the current screen before continuing. Conversations from an earlier application launch may need to be reopened.

An enabled service does not mean every conversation is connected. Check both the service status and the conversation connection counts. Expand **Diagnostics (current app session)** for details, or use [diagnostic export](alwith-docs://guide/troubleshooting).

### Devices and simulators

Simulator tools attach a device to U's device panel so you can watch and interact with it. This is separate from controlling desktop applications or pairing a phone. If you operate the simulator yourself, ask the assistant to read its current screen again before continuing.

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
5. Read any error in the item's catalog or detail page if the expected tool or surface does not appear.

For example, a skill that supplies writing instructions may affect how the assistant approaches a task without adding a new application panel. An application extension may add a panel without becoming a Codex skill.

### When an integration stops working

Record the item's name, enabled state, error text, and the task that triggered the problem. Check configuration and the visible catalog or detail-page errors before reinstalling. If you disable an item to investigate, verify whether the original task can still be completed without it.

### Ask ALwith Docs

ALwith Docs is a bundled Codex skill for questions about ALwith U. Ask a concrete question such as “How do I configure a model in ALwith U?” or explicitly mention `$alwith-docs`. It searches and reads the same versioned content as this user guide. Chapter citations open this guide at the relevant chapter, including when it is already open.

Find **ALwith Docs** in the existing Skills catalog to inspect its instructions or change its enabled state. Enabling the skill does not change your selected model. Its documentation tools are read-only and work offline; they do not inspect credentials or change settings.

The bundled skill is installed automatically by U. An existing user-created skill at the same installation path, or edits to an installed copy, are preserved. If the expected skill is missing, refresh the catalog and read any displayed errors. Use Settings → About → Export diagnostic logs if the cause remains unclear. Documentation responses include the bundled application version. They do not establish newer release behavior or live provider pricing.

## Connect a phone

### Entry and prerequisites

Open the account menu and choose **Mobile connection**. Keep U running and connected. Sign in to ALwith Pocket on the phone before pairing it with this U.

Account sign-in and pairing are separate: signing in identifies your ALwith account; pairing authorizes that phone to access this U's conversations. The connection page links back to **Account** if phone sign-in is still needed.

### Pair this U

1. Enable **Allow phones to connect to this U**.
2. Wait for the connection to become ready, then choose **Show pairing QR code**.
3. In ALwith Pocket on your signed-in phone, open the pairing screen and choose **Scan Pairing QR Code**. Scan the code shown in U.
4. Check for the pairing confirmation and the phone's entry under **Paired phones**.
5. Open a conversation on the phone to verify that it can access the intended U.

Paired phones can view chats, send messages and respond to permission requests. Only pair a device you intend to authorize.

### Pause access or unpair

Turning off phone connections pauses access while keeping paired devices. To remove one phone's access, choose **Unpair** beside that device and confirm. It must pair again to reconnect; unpairing does not sign it out of its ALwith account.

### Common problems

If the QR code expires, use **Refresh pairing QR code** and scan the new code. If the service is disconnected, use **Retry connection** and wait before generating a code. If a phone is signed in but cannot see this U, check pairing and that this U is still running. Do not confuse the account sign-in QR code with the device-pairing QR code.

## Cloud files

### Entry and prerequisites

Open the cloud area in the sidebar when it is available for your account. Check the active cloud configuration and library before making changes. A local project folder and a cloud-managed location are different contexts; selecting a project does not automatically share or upload it.

### Browse and work with a cloud file

1. Select the intended cloud library or folder in the sidebar.
2. Select a file to open its available preview or editor.
3. Save edits with the file's controls, then check transfer status before relying on the remote copy.
4. Use the selected item's context menu for the operations available to that item and your account.

The context menu includes **Sharing and permissions**, **Pin** / **Unpin**, and, for files, **Copy web link** and **Copy desktop link**. Copying a link requires an uploaded file with a remote identity; if U asks you to upload first, resolve that before sharing. A copied link does not grant the recipient access by itself: review sharing permissions too.

Some items also offer **Condense into knowledge**, move or publish actions. Review the destination and the task or confirmation those actions open. Do not treat starting such a workflow as proof that publication completed.

### Confirm a transfer

Open the cloud status entry, inspect the affected item and read any error. A local save and a completed upload are separate events. Confirm the expected synchronized result before sharing it or relying on it from another device.

If a transfer fails, keep local content while checking connectivity, account access and the selected library. Address the displayed cause, then retry through the available controls. Record whether the problem affects one item or the whole connection.

### Find the companion

Vibémon has its own chapter: [Manage Vibémon](alwith-docs://guide/vibemon).

## Manage Vibémon

### Entry and prerequisites

Open **Vibémon** from the sidebar to browse the companion experience available to your ALwith account. If no companion is equipped, select one on the equip page before trying to show it. Availability and account requirements are shown in that interface.

### Show, close or recall a companion

Use the account menu's **Show Vibémon** action to display the equipped companion. When it is displayed, that menu offers the close/hide action. These controls affect its visibility; they do not change your model selection or delete conversations.

The companion's own context menu has **Return to lounge**. Keep this distinct from the account menu's show/close controls: it recalls the companion to its lounge. Check the lounge when looking for a recalled companion.

### Confirm the result and recover

After showing a companion, check that it appears. After recalling it, inspect the lounge. If showing or restoring it fails, read the displayed error, check that a companion is equipped and that your ALwith account is available, then use **Retry** where offered.

A companion resource-sync error does not mean your chat history was deleted. Check the companion's own state before changing unrelated model or cloud settings.

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
| General | General preferences, including available startup and sleep controls. |
| Appearance | Theme and appearance controls. |
| Trackpad | Trackpad interaction preferences. |
| Editor | File-editor preferences. |
| Explorer | File-browser preferences. |
| Account | ALwith account access and phone sign-in. |
| Models | Codex or third-party text-model access. |
| Images | Image-model credentials and connection settings. |
| Voice | Voice enablement, recognition service, microphone and input mode. |
| Computer use | Screen/accessibility permissions, access switch and reconnection. |
| Extensions | Application integration management. |
| Drive | Cloud configuration when available to your account. |
| Import | Detect and import supported setup, projects and chats. |
| About | Application information, update status and diagnostic export. |

Phone pairing is reached from the account menu; it is not a regular entry in the settings sidebar.

Use the setting's label and explanation to understand its scope. Adjusting appearance changes how the application looks; selecting a model changes how that conversation's request is served.

### Learn shortcuts as you work

Start with search and new chat. Button tooltips show the corresponding platform shortcut. Use search to find a conversation rather than scanning every project group manually.

When troubleshooting a keyboard action, check which field or panel has focus. A shortcut pressed inside an editor can have a different context from an action in the main conversation.

### Keep version information with your report

Open the bottom-right terminal icon to inspect the application and Codex versions. Record both when reporting a model or conversation problem. Before restarting for an update, save manual edits and check whether an active task has already changed files.

### Feature-specific setup

Use the dedicated chapters for [images](alwith-docs://guide/images), [voice](alwith-docs://guide/voice), [computer use](alwith-docs://guide/computer), [phone pairing](alwith-docs://guide/mobile) and [imports](alwith-docs://guide/import).

### Keyboard shortcut reference

Choose **Keyboard shortcuts** from the question-mark help menu, or press Command + / on macOS or Ctrl + / on Windows, to open the shortcut reference.

## Troubleshooting

### Essentials
**I signed in, but cannot send a message.** Check model access in settings. ALwith sign-in and model-provider authentication are separate. Read the connection error and confirm a usable model is selected.

**A response is empty, interrupted, or failed.** Check the selected provider and the conversation's activity or error details. Verify connectivity, account quota, and model configuration. Do not assume the reasoning-effort setting is the cause. Check for partial changes before retrying a task that writes files.

**The assistant is working in the wrong folder.** Check the conversation's project folder. Start a chat in the intended project and explicitly identify the files to use.

**A file does not open or an edit does not save.** Verify that the file still exists, that the application can access its location, and that its type supports the requested operation. Preserve unsaved text before closing the editor.

**A plugin or extension is unavailable.** Verify that it is installed and enabled. Read the visible error in its catalog or detail page and confirm any required configuration.

**I need to report a problem.** Record the application and Codex versions, operating system, selected provider and model, steps to reproduce, expected behavior, actual behavior, and the exact error. Remove credentials and private file contents before sharing logs or screenshots.

### Export diagnostic logs

1. Open the account menu, then **Settings → About**.
2. Record the application and Codex versions and choose **Export diagnostic logs**.
3. Choose a destination in the save dialog and wait for the saved confirmation.
4. Include the exact failure, time and reproduction steps with the exported file when reporting the problem.

Review diagnostic files and screenshots for private content before sharing. If export fails, preserve its error and use the text report below. If the interface cannot open, record the error shown on screen instead of attempting an inaccessible settings action.

### Recover from common interruptions

| Symptom | Next step |
| --- | --- |
| “Frontend failed to load” or a blank main window | Capture the exact message. If settings remain available, record the version and update status. Restart U once and check the result; if it repeats, report it with the installed version. Do not delete history or credentials as a generic fix. |
| Conversation connection is interrupted | Wait for connection/recovery to finish, reopen the affected conversation if needed, and inspect its last activity before resending. |
| A selected model is unavailable | Check that provider's saved configuration, model access and visible error. Select another configured model only if you intend to change the conversation's model. |
| Computer tools are disconnected | Use Settings → Computer use → Reconnect, then inspect the current screen before repeating an action. See the computer-use chapter. |
| Image or voice controls are unavailable | Check the corresponding Images or Voice settings; text-model access alone does not configure those services. |
| A phone cannot see chats | Check device pairing, the phone-connection switch and that this U is running. Account login alone is insufficient. |

For any interrupted action, distinguish what already completed from what is still pending. Avoid repeating file writes, submissions or external actions until you have checked their outcome.

### Separate the layers

| Problem area | Useful evidence |
| --- | --- |
| ALwith sign-in | Login error and account state. |
| Model access | Provider, model, authentication error, and quota message. |
| Conversation execution | Tool activity, permission response, and turn error. |
| File work | File location, editor or preview error, and save result. |
| Cloud transfer | Failed item and synchronization status. |
| Integration | Item name, configuration, and catalog or detail-page errors. |

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
