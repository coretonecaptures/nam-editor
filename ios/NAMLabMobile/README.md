# NAMLabMobile

This folder is the home for the NAM Lab iPhone/iPad companion app.

## Expected Xcode Project Location

Create the Xcode project here:

- `ios/NAMLabMobile/NAMLabMobile.xcodeproj`

And the app source folder here:

- `ios/NAMLabMobile/NAMLabMobile/`

## Recommended Xcode Choices

When creating the project in Xcode:

- App template: `iOS App`
- Interface: `SwiftUI`
- Language: `Swift`
- Testing: keep the default test targets if you want them
- Storage: no Core Data for now
- Include CloudKit: no

## Suggested Source Structure

Inside `ios/NAMLabMobile/NAMLabMobile/`, use this layout:

- `App/`
- `Models/`
- `Stores/`
- `Bridge/`
- `Components/`
- `Features/Dashboard/`
- `Features/Training/`
- `Features/Library/`
- `Features/Packs/`
- `Features/Inbox/`
- `Features/Settings/`
- `Preview Content/`

## Initial Product Direction

This should begin as a companion app, not a full NAM Lab replacement.

Best first milestones:

1. mocked app shell and tabs
2. bridge client layer and sample payloads
3. training status screens
4. queue/history/watcher monitoring
5. notifications

See the main plan:

- `docs/ios-companion-plan.md`
