# User Language UI/UX

## Mission

Design the product in the language of the user, not the language of the system.

The interface must translate:

```
internal system model
        ↓
product capability
        ↓
user mental model
        ↓
user goal
        ↓
visible UI
```

Never expose implementation structure merely because it exists in the software.

A technically accurate interface can still be a bad interface.

The primary optimization target is not:

* showing every capability
* exposing every entity
* mirroring the database
* demonstrating component reuse
* looking like a generic SaaS product
* making a visually impressive screenshot

The primary optimization target is:

> Help the user understand where they are, what they can do, what is happening, and how to reach their goal with the least unnecessary cognitive effort.

---

# 1. The Prime Directive

Before designing a screen, complete this sentence:

> **[User] opens this screen because they want to [goal].**

Examples:

Bad:

> This is the Projects dashboard.

Better:

> A project manager opens this screen to find what needs attention today.

Bad:

> This is the Deployment detail page.

Better:

> A developer opens this screen to determine whether the new version is running correctly and what to do if it is not.

Bad:

> This is the Billing settings page.

Better:

> An account owner opens this screen to understand what they are paying for and change how they are billed.

If the goal cannot be identified, do not immediately invent UI.

First infer the most likely user goal from the available product context.

The page structure must follow the goal.

---

# 2. Definition of User Language

User language is not merely UX copy.

User language is the complete translation of the system into the user's mental model.

It has eight layers.

## 2.1 Vocabulary language

Use the words users naturally use for concepts.

Prefer:

```
Team
Project
Invoice
Publish
Invite member
```

over implementation language such as:

```
Tenant
Entity
Resource
Record
Artifact
Provision
Mutation
```

unless those technical terms are genuinely part of the target user's established vocabulary.

Technical users are still users.

Do not remove a technical term merely because it is technical.

Instead ask:

> Does the target user naturally think using this term?

`Git branch`, `DNS record`, `cron`, `HTTP status`, and `SQL query` may be perfectly good user language for the appropriate audience.

---

## 2.2 Goal language

Users usually think in outcomes rather than CRUD operations.

Prefer organizing experiences around:

```
Publish the website
Review failed payments
Invite the team
Fix deployment errors
Prepare this month's report
```

rather than:

```
Create
Read
Update
Delete
Manage records
Resource administration
```

CRUD describes software implementation.

Goals describe why the software exists.

---

## 2.3 Information architecture language

Navigation and grouping must reflect how users classify their work.

Do not automatically convert backend entities into sidebar items.

Backend:

```
users
organizations
projects
jobs
events
resources
configuration
```

does not automatically imply:

```
Users
Organizations
Projects
Jobs
Events
Resources
Settings
```

First determine how users think about the product.

Information architecture should reflect:

* goals
* workflows
* frequency
* relationships users understand
* decision-making context

not database relationships.

---

## 2.4 Interaction language

Interactions should behave according to conventions users already understand.

Do not invent a custom interaction when a familiar pattern already solves the problem well.

A control should make three things reasonably predictable:

1. What can I do?
2. What will happen if I do it?
3. Can I recover if I did not mean to do it?

Prefer recognition over recall.

Show available choices when practical instead of requiring users to remember identifiers, syntax, codes, locations, or previous values.

---

## 2.5 State language

Never expose status without explaining its user consequence.

Weak:

```
Status: Pending
```

Better:

```
Waiting to start

This job will begin when a worker becomes available.
```

Weak:

```
Provisioning failed
```

Better:

```
The server could not start

Your configuration was saved.
Try starting it again or view the technical details.
```

A useful state communicates:

```
What happened
    ↓
What it means
    ↓
What the user can do next
```

Technical diagnostics may exist, but they should normally be secondary to the human explanation.

---

## 2.6 Visual language

Visual hierarchy communicates meaning before copy is read.

Size, position, spacing, grouping, contrast, typography, and visibility tell the user:

* what matters
* what belongs together
* what is interactive
* what is secondary
* what requires attention
* what can safely be ignored

Do not give everything equal visual weight.

Equal-sized cards do not mean "clean design."

They mean:

> Everything on this page appears equally important.

Only do this when that statement is actually true.

---

## 2.7 Disclosure language

Show complexity when the user needs complexity.

Do not show every available option merely because the product supports it.

Default experience:

```
frequent
important
decision-relevant
```

Secondary disclosure:

```
infrequent
advanced
diagnostic
dangerous
specialist
exceptional
```

Use progressive disclosure rather than either extreme:

```
expose everything
```

or:

```
remove useful expert functionality
```

---

## 2.8 Accessibility language

An interface is not understandable if its meaning exists only through:

* color
* position
* hover
* tiny icons
* animation
* visual shape

Important information and actions must remain understandable with keyboard navigation, assistive technology, zoom, increased text size, reduced motion, and different perceptual abilities.

Accessibility is part of user language, not a post-processing task.

---

# 3. Required Design Pass Before Coding

Before writing production UI code, perform the following reasoning.

Do not mechanically show this analysis to the user unless it is useful.

## Step 1 — Identify the user

Determine:

```
Who is using this?
What domain knowledge do they have?
How frequently do they perform this task?
What are they trying to accomplish?
What mistakes are expensive?
What information do they already know?
What environment are they working in?
```

Classify the primary audience when useful:

### Novice

Needs more orientation, examples, guidance, safe defaults, and visible choices.

### Expert

Needs speed, density, shortcuts, bulk actions, comparison, persistence, keyboard efficiency, and reduced ceremony.

### Mixed

Use a simple primary path with progressive disclosure and efficient expert paths.

Do not design professional software as if professional users were beginners.

Do not design beginner software as if users had read the documentation.

---

## Step 2 — Build the task model

Separate goals from tasks.

Example:

Goal:

```
Get the website online.
```

Tasks may include:

```
connect repository
choose branch
configure domain
deploy
verify deployment
```

"Fill out deployment form" is not the user goal.

The form is merely one implementation of a task.

Prefer workflows that reduce unnecessary tasks instead of merely beautifying them.

---

## Step 3 — Build the vocabulary map

For important concepts, mentally construct:

| System concept     | User concept         | UI term               |
| ------------------ | -------------------- | --------------------- |
| tenant             | company              | Organization          |
| provision instance | start server         | Start server          |
| artifact           | uploaded model       | Model                 |
| mutation failed    | change was not saved | Couldn't save changes |

Use one term consistently for one concept.

Do not alternate between synonyms simply to make copy sound varied.

Consistency is more important than literary variety.

---

## Step 4 — Define the page's decision

Ask:

> What decision or action should become easier because this page exists?

A good dashboard is not a collection of statistics.

A good dashboard helps someone decide something.

Instead of automatically generating:

```
Total users
Total projects
Total tasks
Completion rate
```

determine whether the user actually needs to know:

```
What needs attention?
What changed?
What is blocked?
What is unusual?
What should I do next?
```

Do not create KPI cards merely because the word "dashboard" appeared in the prompt.

---

## Step 5 — Establish hierarchy

Every screen should have an intentional reading order.

A common hierarchy is:

```
Page identity
    ↓
Current situation
    ↓
Primary task / decision
    ↓
Supporting information
    ↓
Secondary actions
    ↓
Advanced / diagnostic details
```

The hierarchy may differ by product, but it must be deliberate.

Ask:

> If the user only notices three things on this screen, which three should they be?

Make those three visually obvious.

---

# 4. Navigation Rules

Navigation labels should have strong information scent.

The label should let the user reasonably predict what they will find after selecting it.

Prefer specific destinations:

```
Invoices
Team members
Deployment history
API keys
Usage limits
```

Be suspicious of vague categories:

```
Manage
Overview
Resources
General
Miscellaneous
More
Tools
```

These words are not always forbidden, but they require justification.

Do not use organization-chart navigation unless the user's mental model actually matches the organization.

Do not hide primary navigation solely to make the screen look minimal.

Discoverability is more important than decorative minimalism.

---

# 5. Action Language

Buttons should normally describe the action or result.

Prefer:

```
Create project
Send invitation
Save changes
Publish article
Retry payment
Disconnect GitHub
```

Be cautious with:

```
Submit
Confirm
Continue
Proceed
Manage
Do it
Let's go
```

Generic labels are acceptable when the surrounding flow makes their consequence completely obvious, but specific labels are usually stronger.

For consequential actions, name the consequence.

Prefer:

```
Delete workspace
```

over:

```
Confirm
```

Never use playful or clever wording at the cost of predictability.

---

# 6. Forms

Forms exist to help users achieve a goal.

They do not exist to expose a database schema.

Only request information that is necessary at the current stage.

Prefer:

* visible labels
* meaningful defaults
* familiar formats
* selections over memorized identifiers
* examples when formats are unusual
* inline validation where useful
* preserving entered data after errors
* grouping related questions
* showing dependencies only when relevant

Do not use placeholder text as the only label.

Do not request information merely because the backend model contains the field.

Do not ask the user to manually provide information the system already knows.

Before adding help text, ask whether the control itself can be made clearer.

---

# 7. Tables and Data-Dense Interfaces

Do not replace useful professional density with decorative cards.

Use tables when users need to:

* scan many records
* compare attributes
* sort
* filter
* find anomalies
* perform repeated actions
* make decisions across rows

Prioritize columns according to the task.

Do not show every database field.

Put rare metadata in details or secondary views.

For expert applications, support appropriate efficiency features:

```
keyboard navigation
bulk selection
batch actions
persistent filters
saved views
inline editing
fast search
column customization
```

when the task genuinely benefits from them.

Density is not inherently bad.

**Unstructured density is bad.**

---

# 8. Status, Feedback, and System State

The user should never have to wonder whether the system noticed their action.

Represent important states explicitly.

Consider:

```
initial
loading
empty
ready
changed
saving
success
partial success
warning
failed
unavailable
offline
permission denied
destructive
unsaved changes
```

Do not design only the ideal populated state.

Loading feedback must indicate that something is happening.

Empty states should explain why the area is empty and what the user can do when an action makes sense.

Success feedback should confirm meaningful completion.

Errors should contain, where available:

```
what happened
what was affected
whether user data was preserved
how to recover
what to do next
```

Do not lead with:

```
Error 500
INVALID_REQUEST
RPC_FAILED
unknown_error
```

unless the target user explicitly needs that diagnostic information.

Technical details can be available behind:

```
Technical details
View logs
Error details
```

---

# 9. User Agency

Prefer reversible actions where possible.

Provide appropriate mechanisms such as:

```
Undo
Cancel
Retry
Restore
Back
Edit
```

Do not ask "Are you sure?" for every trivial action.

Use confirmation when consequences are difficult to reverse, destructive, expensive, externally visible, legally significant, or unusually risky.

For reversible actions, performing the action and offering Undo is often better than repeatedly interrupting users.

Never silently perform a surprising destructive action.

---

# 10. Progressive Disclosure

Complex products may remain powerful without presenting all complexity simultaneously.

Primary layer:

```
what most users need most often
```

Secondary layer:

```
advanced configuration
rare actions
diagnostics
raw metadata
dangerous operations
```

Example for developer tooling:

Primary:

```
Connect GitHub
Repository
Branch
Deploy
```

Advanced:

```
Client ID
Callback URL
OAuth scopes
webhook secrets
raw deployment identifiers
```

Do not remove technical capability.

Put technical capability at the level where it becomes useful.

For expert workflows that frequently require advanced information, promote that information rather than hiding it mechanically.

Progressive disclosure must follow usage, not ideology.

---

# 11. Visual Grammar

Use visual design to clarify structure.

## Hierarchy

Important content must look important.

Secondary metadata should not compete with primary actions.

## Proximity

Use spacing to communicate relationships before adding boxes, borders, or background panels.

## Containers

Do not put every section inside a card.

Cards are useful when content is independently meaningful or interactive.

Avoid:

```
card
  inside card
    inside another card
```

Avoid "card soup."

## Typography

Use a restrained hierarchy.

Do not create a new font size and weight for every component.

Typography should communicate:

```
page
section
item
supporting metadata
```

## Color

Use color primarily for:

```
hierarchy
interaction
status
meaning
```

Do not require color alone to communicate status.

Do not turn every status into a brightly colored pill.

## Icons

Use icons when they improve recognition.

Avoid icon-only actions unless:

* the symbol is highly conventional
* the action is contextually obvious
* an accessible name exists
* discoverability is not harmed

When uncertain, pair icon + text.

## Motion

Motion should explain:

```
cause and effect
hierarchy
transition
continuity
state
```

Do not animate merely to make the interface appear sophisticated.

Respect reduced-motion preferences.

---

# 12. Content Design

UI copy should normally be:

```
clear
direct
concise
specific
respectful
consistent
action-oriented
```

Put important words early.

Prefer active constructions.

One sentence should usually communicate one idea.

Do not write more text to compensate for a confusing interface.

Fix the interface first.

Avoid unnecessary:

```
marketing language
corporate language
internal terminology
cute wording
fake enthusiasm
technical jargon
verbosity
```

Do not sacrifice necessary precision merely to make copy shorter.

---

# 13. Designing for Experts

Expert software deserves user-centered design too.

Do not assume:

> Technical users tolerate bad UX.

They may understand implementation language while still preferring efficient task language.

For expert tools, optimize for:

```
repeatability
speed
comparison
interruption recovery
keyboard usage
batch operations
high information value
stable spatial patterns
```

A good expert interface may be dense.

Its density should correspond to meaningful decisions and workflows.

Avoid turning developer tools, operations consoles, analytics products, financial software, IDE-like products, or admin systems into oversized consumer-mobile layouts unless that context genuinely fits.

Primary workflows can speak task language while advanced surfaces expose precise technical language.

---

# 14. Familiarity and Mental Models

People bring expectations from other software.

Honor strong conventions unless there is a meaningful reason not to.

Examples include familiar expectations around:

```
search
links
back navigation
tabs
checkboxes
menus
tables
save behavior
keyboard focus
destructive actions
```

Novel interaction creates a learning cost.

Pay that cost only when the new interaction provides meaningful value.

Do not redesign standard controls merely to look distinctive.

---

# 15. Recognition Over Recall

Whenever practical, allow the user to recognize information instead of remembering it.

Weak:

```
Enter Workspace ID
[________________]
```

Better:

```
Choose workspace

○ Personal
○ Acme
○ Research
```

Weak:

```
Enter repository slug
```

Better:

```
Search repositories
```

Weak:

```
Type exact status
```

Better:

```
Select status
```

Do not force users to memorize system-generated values unless those values are themselves part of the professional workflow.

---

# 16. Error Prevention

The best error message is often preventing the error.

Use:

```
constraints
appropriate defaults
disabled impossible actions
clear consequences
previews
validation
sensible ranges
selections
warnings
```

to reduce predictable mistakes.

Do not disable controls without making the reason discoverable.

Do not validate in ways that punish normal typing.

Do not erase valid user input because one field is wrong.

---

# 17. Accessibility

For web interfaces, aim for current WCAG AA expectations unless project requirements specify otherwise.

At minimum:

* semantic structure
* correct heading order
* keyboard-operable controls
* visible focus
* programmatic names
* visible form labels
* understandable error text
* sufficient contrast
* adequate interaction targets
* no color-only meaning
* accessible status updates
* support zoom and text resizing
* respect reduced motion
* preserve usability with screen readers

Accessibility behavior must be considered while choosing the component, not added after visual implementation.

Prefer native semantic elements over custom reimplementations whenever practical.

---

# 18. Context Before Minimalism

Minimalism means removing what does not help the task.

It does not mean removing context.

A UI can be visually sparse and cognitively difficult.

Do not hide:

```
labels
navigation
state
units
consequences
context
relationships
```

merely to create a clean screenshot.

The correct objective is:

> Maximum useful signal with minimum unnecessary noise.

not:

> Minimum number of visible elements.

---

# 19. AI UI Anti-Patterns

When generating interfaces, actively detect and reject common AI-generated patterns.

## Generic dashboard reflex

Do not automatically generate:

```
four KPI cards
line chart
recent activity
sidebar
user avatar
notification bell
```

unless the user's task requires them.

## Card soup

Do not place every piece of information into an equal rounded rectangle.

## Sidebar from backend nouns

Do not generate navigation simply by pluralizing database entities.

## Decorative gradients

Do not use gradients, glass effects, glows, enormous border radii, or floating blobs simply to make the result appear "designed."

Visual decoration requires a product reason.

## Meaningless statistics

Do not invent metrics just to fill a dashboard.

## Status-pill inflation

Do not convert every property into a colorful badge.

## Settings landfill

Do not put unrelated functionality into a giant Settings screen merely because its information architecture is unresolved.

## Modal reflex

Do not use a modal for every creation and editing workflow.

Use the interaction surface that best matches complexity and context.

## Icon-only minimalism

Do not remove useful labels for aesthetic reasons.

## Fake enterprise complexity

Do not add tabs, filters, tables, charts, permission matrices, or configuration fields solely to make software appear powerful.

## Fake consumer simplicity

Do not replace efficient professional controls with enormous whitespace and step-by-step screens when users need rapid repeated work.

## Component-first design

Do not begin with:

```
What components can I put here?
```

Begin with:

```
What does the user need to understand or accomplish here?
```

Components come later.

---

# 20. Existing Products

When modifying an existing product:

1. Preserve established terminology unless it is clearly harmful.
2. Preserve useful interaction conventions.
3. Reuse the existing design system.
4. Avoid gratuitous visual redesign.
5. Improve hierarchy before replacing components.
6. Do not introduce a second design language inside one product.
7. Treat existing user habits as part of the mental model.
8. Make large interaction changes only when their benefit justifies relearning.

Consistency does not mean every screen must look identical.

Consistency means similar things should behave similarly.

---

# 21. When User Language Is Unknown

Do not invent branded terminology prematurely.

Infer vocabulary in this order when evidence exists:

```
words used by actual users
    ↓
user-provided product language
    ↓
support/search/research language
    ↓
established domain terminology
    ↓
established platform conventions
    ↓
conservative plain-language fallback
```

Competitor terminology is evidence of convention, not automatic proof.

Internal engineering terminology is not evidence of user language.

Treat unsupported assumptions as assumptions.

---

# 22. Implementation Rules

After the UX model is established, implementation should preserve it.

Use the project's existing component library and patterns where appropriate.

Prefer semantic native controls.

Implement responsive behavior according to task priority, not by merely stacking desktop cards vertically.

Keep primary actions visible at appropriate breakpoints.

Ensure state changes have feedback.

Implement empty, loading, failure, and permission states.

Do not ship the happy path alone.

Use design tokens rather than arbitrary one-off styling when a design system exists.

Do not add dependencies merely for visual novelty.

Do not sacrifice accessibility to reproduce a mockup pixel-for-pixel.

---

# 23. Responsive Design

Responsive design is not:

> desktop layout, but narrower.

At each breakpoint ask:

```
What is still essential?
What must remain visible?
What can move?
What can collapse?
What can become sequential?
What requires comparison?
What cannot safely disappear?
```

Tables may need horizontal scrolling, column prioritization, or alternate representations.

Do not automatically convert every table row into a giant card on mobile.

Do not hide essential actions behind ambiguous overflow menus without need.

---

# 24. The Four-Question Test

A user encountering a screen should quickly be able to answer:

### 1. Where am I?

The page clearly communicates its identity and context.

### 2. What can I do here?

Important actions are visible and understandable.

### 3. What will happen if I do it?

Labels and interaction patterns make consequences predictable.

### 4. How will I know it worked?

The interface provides visible and understandable feedback.

If the screen fails any of these questions, revise it before polishing visuals.

---

# 25. The Five-Second Test

Look at the interface without interacting.

Within roughly a few seconds, the visual hierarchy should communicate:

```
what this page is
what matters most
what needs attention
what the primary next action is
```

If every element is shouting, nothing is important.

If nothing is visually emphasized, the user must reconstruct the hierarchy manually.

---

# 26. Final Heuristic Review

Before considering the UI complete, verify:

## System status

Can the user tell what is happening?

## User-world match

Does the interface speak the target user's language?

## User control

Can users cancel, go back, undo, or recover where appropriate?

## Consistency

Do similar things look and behave similarly?

## Error prevention

Have predictable mistakes been prevented?

## Recognition

Does the interface minimize unnecessary memorization?

## Efficiency

Can frequent users work efficiently?

## Signal-to-noise

Does every prominent element deserve attention?

## Error recovery

Do errors explain how to recover?

## Help

Is help available where genuine complexity remains?

Failure of several of these checks means the interface is not ready merely because it looks polished.

---

# 27. User-Language Design Gate

Before finalizing any significant UI, answer these questions:

```
Who is the primary user?

What are they trying to accomplish?

What is their most likely next action?

Which words would they use to describe the objects on screen?

Does the navigation reflect their mental model or our backend?

What information helps them make the current decision?

What information is merely available but irrelevant?

Are technical details exposed at the correct level?

Can the user recognize choices instead of recalling them?

Are important states understandable?

Can mistakes be prevented or recovered from?

Is the primary action visually obvious?

Is anything prominent only because it looks impressive?

Is anything hidden only because minimalism looks attractive?

Does this interface become faster, not slower, for frequent users?

Can the interface be operated and understood accessibly?
```

If any answer exposes a mismatch, revise the design.

After implementation, review the result with [`ui-review.md`](./ui-review.md).

---

# 28. Final Principle

The interface is a translation layer.

The backend thinks in:

```
entities
resources
permissions
states
events
schemas
APIs
```

The user thinks in:

```
goals
objects they recognize
decisions
consequences
progress
problems
next actions
```

Good UI design performs the translation.

Never make the user perform it.

When forced to choose between:

```
implementation elegance
generic visual polish
component symmetry
screenshot aesthetics
```

and:

```
user comprehension
task completion
predictability
efficiency
recoverability
```

prefer the user.

**Design from the user's model inward, then implement from the system outward.**
