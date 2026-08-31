# UI Review

## Mission

Review interfaces from the user's point of view.

Do not ask:

> Does this UI look modern?

Ask:

> Can the intended user understand the interface, make the right decision,
> complete the intended task efficiently, predict what will happen,
> and recover when something goes wrong?

A polished interface can still be a bad interface.

A visually plain interface can still be an excellent interface.

Review usability before aesthetics.

Review task structure before components.

Review information hierarchy before styling.

Review causes before symptoms.

This document is the Desktop UI review guideline. Design intent lives in [`user-language-ui.md`](./user-language-ui.md). Visual tokens and renderer craft rules live in [`DESIGN.md`](../DESIGN.md).

---

# 1. Core Review Principle

The review order is:

```
User
  ↓
Goal
  ↓
Task
  ↓
Mental model
  ↓
Information architecture
  ↓
Interaction
  ↓
System state
  ↓
Visual hierarchy
  ↓
Accessibility
  ↓
Visual craft
```

Do not reverse this order.

Do not start with:

```
border radius
shadows
colors
card styling
gradients
font size
```

when a more fundamental task or information architecture problem exists.

---

# 2. Review Modes

Use this document in two modes.

## Review Mode

Analyze the interface and report problems without modifying implementation.

Use when the task is to review, critique, or evaluate a page, flow, screenshot, or implementation.

## Refactor Mode

Analyze first, then make the smallest effective implementation changes.

Use when the review is followed by implementation: fix the UI, redesign a page, or reduce user effort.

Never skip the review and jump directly into visual changes.

---

# 3. Evidence Hierarchy

Base review decisions on the strongest evidence available.

Prefer, in order:

```
observed user behavior / research
    ↓
explicit product requirements
    ↓
known user goals and workflows
    ↓
existing product terminology and conventions
    ↓
established domain conventions
    ↓
platform conventions
    ↓
established usability principles
    ↓
reviewer inference
```

Distinguish evidence from assumption.

When user context is incomplete, infer cautiously.

Do not pretend an inferred persona is known fact.

---

# 4. Establish Context Before Reviewing

Before evaluating individual UI elements, identify:

## Primary user

Who is this interface for?

Consider:

```
novice
occasional user
frequent user
expert user
administrator
operator
developer
analyst
creator
consumer
```

## Primary goal

Complete:

> **[User] opens this screen because they want to [goal].**

## Primary task

Identify the action or decision the interface exists to support.

## Frequency

Determine whether the task is:

```
rare
occasional
frequent
continuous
```

Frequency strongly changes appropriate UI design.

A one-time onboarding flow and a tool used eight hours per day should not be reviewed with the same expectations.

## Risk

Determine whether mistakes are:

```
trivial
reversible
expensive
destructive
externally visible
security-sensitive
legally significant
```

Review safeguards according to actual risk.

---

# 5. User Success Comes Before Visual Quality

The first review question is:

> Does this screen help the user achieve the intended goal?

Look for:

* features unrelated to the main task
* important information hidden by decorative content
* dashboards that report statistics without helping decisions
* workflows organized around backend entities
* screens that exist because a database entity exists
* actions that make sense to engineers but not users
* workflows requiring unnecessary steps

A page can have perfect spacing and still fail this review.

---

# 6. Task Alignment Review

For the primary task, determine:

```
trigger
starting context
information needed
decision required
action required
result
feedback
recovery
```

Ask:

### Is the task obvious?

Can users understand what this screen is for?

### Is the next step obvious?

Does the primary action follow naturally from the user's goal?

### Is unnecessary work required?

Look for:

```
unnecessary navigation
duplicate data entry
unnecessary confirmation
repeated selection
unnecessary context switching
avoidable setup
manual work the system could perform
```

### Are prerequisites understandable?

If something cannot yet be done, does the UI explain why?

---

# 7. Cognitive Walkthrough

For important workflows, perform a task-based walkthrough.

At each step ask:

## 1. Will the user know what they are trying to do?

The goal must remain understandable.

## 2. Will the user notice the correct action?

The action must be visible and discoverable.

## 3. Will the user understand that the action moves them toward their goal?

Labels and context must establish the relationship.

## 4. After acting, will the user understand what happened?

Feedback must communicate progress or completion.

Record the first point at which the task becomes uncertain.

Do not judge only the final screen.

---

# 8. User Language Review

Review whether the interface speaks the user's language.

Detect:

## System-language leakage

Examples:

```
Entity
Artifact
Object
Payload
Record
Instance
Resource
Handler
Mutation
```

These terms may be legitimate in technical domains.

Flag them only when they reflect implementation rather than the user's established vocabulary.

## Generic action language

Be suspicious of:

```
Submit
Proceed
Confirm
Manage
Continue
Execute
```

when a more specific consequence can be stated.

Prefer actions that communicate outcomes.

## Inconsistent vocabulary

One concept should normally have one stable name.

Flag cases where the interface alternates among:

```
Workspace
Project
Environment
Space
```

for the same concept.

Do not reward literary variety in UI copy.

Consistency reduces interpretation cost.

---

# 9. Mental Model Review

Ask:

> Does the UI represent the system the way users believe the work is organized?

Look for mismatches between:

```
backend model
organizational structure
technical architecture
```

and:

```
user tasks
domain concepts
workflow
expectations
```

Common failure:

Backend:

```
organizations
projects
jobs
executions
resources
```

Navigation:

```
Organizations
Projects
Jobs
Executions
Resources
```

This may simply expose the database structure.

Do not assume backend entities deserve navigation entries.

---

# 10. Information Architecture Review

Review whether information is grouped and ordered according to user expectations.

Check:

```
category boundaries
grouping
hierarchy
naming
navigation depth
relationship between screens
location awareness
```

Ask:

> Can the user predict where something belongs?

> Can the user tell where they currently are?

> Are related things together?

> Are unrelated things grouped merely for technical convenience?

Be suspicious of "Settings" becoming a dumping ground.

---

# 11. Information Scent Test

Evaluate every important navigation label, link, and CTA.

Imagine seeing the label without clicking.

Can the user reasonably predict what is behind it?

Strong scent:

```
Team members
API keys
Billing history
Deployment logs
Failed payments
```

Weak scent:

```
Manage
General
More
Resources
Tools
Advanced
Overview
```

Weak terms are not automatically wrong.

Flag them when their destination cannot be predicted from context.

Search, command palettes, and favorites do not compensate for incoherent navigation.

---

# 12. Five-Second Hierarchy Test

Inspect the interface without interacting.

Determine:

### What is seen first?

### What is seen second?

### What is seen third?

Then ask:

> Are these the three things the user should notice first?

If not, there is a hierarchy problem.

Possible causes:

```
inappropriate size
excessive contrast
equal card weight
decorative imagery
loud secondary buttons
oversized headings
badge inflation
excessive color
incorrect placement
```

Visual hierarchy should match task hierarchy.

---

# 13. Attention Budget

Treat user attention as limited.

Every prominent element spends attention.

Flag UI that spends attention on:

```
decorative metrics
irrelevant metadata
unnecessary illustrations
excessive container borders
redundant headings
repeated labels
low-value badges
secondary actions
decorative animation
```

The goal is not minimum content.

The goal is maximum useful signal relative to noise.

Do not confuse minimalism with usability.

---

# 14. Interaction Tax

For important tasks, identify unnecessary interaction cost.

Use the following qualitative model:

```
Interaction Tax =
    Finding
  + Interpreting
  + Remembering
  + Entering
  + Switching
  + Waiting
  + Confirming
  + Recovering
```

## Finding tax

How hard is the correct action to locate?

## Interpretation tax

How much thinking is required to understand labels or state?

## Memory tax

What must the user remember from another screen, previous step, documentation, or system-generated identifier?

## Entry tax

How much information must be typed manually?

## Switching tax

How often must users change screen, tab, modal, application, or context?

## Waiting tax

Where does the user wait without useful feedback?

## Confirmation tax

How often is the user interrupted to confirm low-risk actions?

## Recovery tax

How much work is lost when something goes wrong?

Do not invent a meaningless numeric score.

Describe where the tax comes from and how to reduce it.

---

# 15. Recognition Over Recall

Flag unnecessary memorization.

Examples:

Weak:

```
Enter workspace ID
```

Better:

```
Choose workspace
```

Weak:

```
Type repository slug
```

Better:

```
Search repositories
```

Weak:

```
Enter exact status
```

Better:

```
Select status
```

Also detect when users must:

```
remember previous values
copy values across pages
memorize icon meanings
remember hidden commands
recall where settings live
```

Experts may legitimately memorize shortcuts.

Shortcuts should accelerate interaction, not be the only discoverable path unless the product context explicitly supports that model.

---

# 16. Action Hierarchy

Classify actions as:

```
primary
secondary
tertiary
destructive
```

The visual design should communicate the hierarchy.

Do not give five actions equal emphasis when one is clearly most important.

Check whether:

* the primary action is easy to find
* destructive actions are appropriately separated
* secondary actions compete with primary content
* overflow menus contain actions that should actually be visible
* too many primary-style buttons create visual noise

One primary action is a useful default, not an absolute law.

Professional applications may legitimately contain multiple high-frequency controls.

Review according to task context.

---

# 17. Forms and Data Entry

Review forms as workflows rather than collections of fields.

Check:

## Necessity

Is every field needed now?

## Knowledge

Does the user know the requested information?

## Existing data

Does the system already know it?

## Format

Is the accepted format clear and reasonably tolerant?

## Labels

Are labels visible and specific?

## Defaults

Can safe defaults reduce work?

## Recognition

Could selection replace memorization?

## Dependencies

Are conditional questions shown only when relevant?

## Persistence

Does valid user input survive errors?

## Validation

Does validation help rather than punish?

Do not expose database schemas as forms.

---

# 18. Error Prevention Review

Do not only review error messages.

Ask whether predictable errors can be prevented.

Look for opportunities using:

```
constraints
defaults
previews
validation
autocomplete
format tolerance
disabled impossible choices
warnings
confirmation for genuine risk
Undo
```

Flag situations where the design waits for predictable failure and then blames the user.

---

# 19. Error Recovery Review

For every meaningful error, check whether the interface answers:

```
What happened?
    ↓
What was affected?
    ↓
Was my work preserved?
    ↓
How can I fix it?
    ↓
What can I do next?
```

Weak:

```
Error 422
```

Weak:

```
Invalid configuration
```

Weak:

```
Something went wrong
```

Better errors explain the specific problem and useful next action.

Technical diagnostics may be available separately for expert users.

Do not replace useful technical detail when the intended user genuinely needs it.

---

# 20. System Status and Feedback

Review important state transitions.

Check:

```
loading
saving
processing
success
partial completion
queued
failed
unavailable
offline
permission denied
destructive action
unsaved changes
```

Users should not wonder:

```
Did my click work?
Is it still processing?
Did it save?
Can I leave?
Did I lose my work?
```

Long-running operations should communicate progress or meaningful state when possible.

Do not use fake precision.

---

# 21. Empty-State Review

Do not accept generic empty states by default.

Evaluate whether the empty state explains:

```
why this area is empty
whether that is normal
what can be done next
```

Avoid automatically inserting:

```
large illustration
cheerful headline
generic "Get started" CTA
```

The appropriate empty state may simply be concise information.

If the user cannot act, do not create a fake CTA.

---

# 22. Expert Efficiency Review

Before recommending simplification, determine whether the interface serves frequent or professional users.

For expert workflows, evaluate:

```
information density
scan speed
comparison
keyboard access
shortcuts
bulk operations
inline actions
persistent filters
saved views
sorting
search
multi-selection
customizable columns
spatial stability
interruption recovery
```

Do not automatically transform dense professional software into a consumer-style interface.

Do not expand every operation into a wizard.

Do not hide frequently used expert controls behind repeated disclosure.

Do not replace tables with cards merely because cards look modern.

Complexity that reflects the real task may be legitimate.

The goal is:

> remove accidental complexity without destroying useful complexity.

---

# 23. Table Review

Use tables when comparison across repeated structured data is important.

Review:

```
column priority
scanability
alignment
sorting
filtering
selection
row actions
density
truncation
responsive behavior
```

Flag:

```
database-field dumping
excessive columns
important columns pushed out of view
actions repeated as large buttons on every row
poor numeric alignment
unclear column labels
ambiguous status values
```

For expert users, a good table may be dense.

Density itself is not a defect.

---

# 24. Progressive Disclosure Review

Determine whether complexity is shown at the correct level.

Good candidates for secondary disclosure:

```
rare actions
diagnostics
raw metadata
advanced settings
destructive controls
specialist configuration
```

Bad disclosure hides:

```
primary actions
frequently checked state
recurring expert controls
necessary context
```

Do not praise hidden interfaces merely because they look clean.

Every disclosure adds an interaction cost.

Hide only when the reduction in cognitive load is worth that cost.

---

# 25. Modal Review

AI-generated interfaces often overuse modals.

For each modal ask:

> Does this task genuinely benefit from interrupting the current context?

Modals are appropriate for some:

```
confirmations
short focused tasks
critical decisions
temporary context
```

Be suspicious when used for:

```
long forms
complex editing
multi-step workflows
reference-heavy tasks
tasks requiring comparison with background content
```

Do not make every "Create" action a modal by default.

---

# 26. Visual Structure Review

Review visual design as information structure.

Evaluate:

```
grouping
proximity
alignment
whitespace
repetition
emphasis
hierarchy
reading order
```

Spacing should communicate relationships.

Borders should not be the only grouping mechanism.

Related information should look related.

Unrelated information should not appear connected merely because it shares a container.

---

# 27. Card Review

Cards are not the default unit of UI.

Flag "card soup":

```
card
  card
    card
```

or pages where every piece of information is independently boxed.

Ask:

> Does this content actually represent a distinct object or independently meaningful unit?

If no, grouping with spacing, headings, dividers, or layout may communicate structure more clearly.

Equal cards imply equal conceptual weight.

Use that implication intentionally.

---

# 28. Typography Review

Review typography for hierarchy and scanning.

Check whether:

```
page title
section title
item title
body text
metadata
```

are visually distinguishable without excessive variations.

Flag:

```
giant headings with low information value
too many text styles
excessive bold
weak body contrast
unreadably small metadata
ALL CAPS used for attention
poor line length
unnecessary center alignment
```

Typography should help users navigate information.

---

# 29. Color Review

Color should communicate:

```
hierarchy
interaction
state
category
brand
```

Flag:

```
color used only decoratively at high prominence
too many semantic colors
status encoded only by color
low contrast
multiple colors competing for attention
gradients interfering with readability
```

Do not equate "more colorful" with "better designed."

---

# 30. Icon Review

For every important icon-only action ask:

> Would the target user know what this means without experimentation?

Prefer text labels when meaning is ambiguous.

Familiar toolbars may use compact icons for expert efficiency.

When icons are used:

```
keep meanings consistent
provide accessible names
provide tooltips where appropriate
preserve adequate target size
avoid relying on hover alone
```

Do not remove labels merely to create a cleaner screenshot.

---

# 31. Responsive Review

Responsive design is not:

> stack desktop cards vertically.

At important breakpoints ask:

```
What remains essential?
What should remain visible?
What can collapse?
What can move?
What can become sequential?
What requires comparison?
What must not disappear?
```

Review whether content reflows without losing meaning.

Do not hide critical actions merely because space becomes smaller.

Do not automatically convert useful tables into giant cards.

Consider:

```
prioritized columns
horizontal scrolling
detail views
alternate layouts
progressive disclosure
```

according to task requirements.

---

# 32. Platform Familiarity

Users bring knowledge from operating systems and other products.

Check whether standard interactions behave conventionally.

Examples:

```
back
search
links
tabs
checkboxes
radio buttons
menus
save
cancel
selection
keyboard focus
```

Novel interaction creates learning cost.

Recommend novelty only when the benefit justifies it.

---

# 33. Accessibility Review

Accessibility is part of usability.

For web interfaces, use current WCAG AA expectations as the default reference unless project requirements specify otherwise.

Review:

## Semantic structure

Use meaningful HTML and heading hierarchy.

## Keyboard

All meaningful operations should be keyboard accessible when applicable.

## Focus

Focus must be visible and should not become hidden behind overlays, sticky elements, or dialogs.

## Targets

Important pointer targets must be practical to activate and sufficiently separated.

## Alternatives

Do not make dragging the only way to complete an action when a simpler pointer method can exist.

## Labels

Controls require understandable accessible names.

Visible labels should correspond with accessible names.

## Color

Meaning cannot rely on color alone.

## Status

Important asynchronous status changes must be accessible to assistive technology.

## Repetition

Avoid forcing users to re-enter information the system already received in the same workflow unless necessary.

## Zoom and reflow

The interface should remain usable with zoom and enlarged text.

## Motion

Respect reduced-motion preferences.

Accessibility findings are not automatically "cosmetic."

A blocked interaction can be Critical.

---

# 34. Trust and Consequence Review

Review whether the interface accurately communicates consequential actions.

Pay special attention to:

```
deletion
publishing
billing
permissions
sending
external changes
irreversible operations
security
privacy
```

Users should understand:

```
what will happen
what will change
who will see it
whether it can be reversed
```

Avoid dark patterns.

Do not visually disguise harmful or consequential actions.

---

# 35. AI-Generated UI Smell Detection

Actively check for patterns common in generic generated interfaces.

These are smells, not automatic failures.

## Generic SaaS dashboard

```
sidebar
four KPI cards
chart
recent activity
avatar
notification bell
```

without evidence these help the task.

## Meaningless metrics

Statistics exist because dashboard templates expect statistics.

## Card soup

Every concept exists inside the same rounded card.

## Badge inflation

Every property becomes a colored pill.

## Gradient decoration

Gradients, glow, glass, blur, or floating shapes without functional purpose.

## Giant-title syndrome

Large headings consume valuable workspace without increasing understanding.

## Whitespace inflation

Sparse layouts that force professional users to scroll unnecessarily.

## Fake activity feed

Recent activity exists without a demonstrated user need.

## Backend sidebar

Navigation mirrors database nouns.

## Settings landfill

Unresolved IA is hidden inside Settings.

## Modal reflex

Every secondary task opens a dialog.

## Three-dot overflow abuse

Important actions are hidden simply to make the interface look clean.

## Icon-only minimalism

Labels disappear in exchange for ambiguous glyphs.

## Fake enterprise complexity

Unnecessary:

```
filters
charts
tabs
permission matrices
configuration
metadata
```

are added to make the product appear sophisticated.

## Fake consumer simplicity

Professional capabilities are replaced by:

```
giant cards
giant buttons
step-by-step wizards
excessive spacing
```

that slow repeated work.

## Component symmetry

The layout prioritizes visual symmetry over task priority.

## Happy-path-only UI

Loading, failure, empty, permission, destructive, and offline states are ignored.

## Placeholder product language

Generic terms such as:

```
Workspace
Resource
Overview
Manage
```

appear because they are common SaaS vocabulary rather than actual product vocabulary.

When detecting an AI smell, explain the concrete usability consequence.

Do not criticize a pattern solely because AI often generates it.

---

# 36. Severity Model

Do not use arbitrary visual scores like:

```
UI: 7/10
UX: 8/10
```

Prioritize findings according to user impact.

## Critical

Prevents task completion, causes severe misunderstanding, creates serious accessibility blocking, or creates significant risk.

Examples:

```
primary task cannot be completed
destructive action is misleading
keyboard-only user cannot access core workflow
saved changes appear successful but are not
```

## High

Creates substantial delay, error risk, repeated confusion, or serious inefficiency in an important workflow.

Examples:

```
primary CTA is difficult to discover
navigation model conflicts with user task
frequent expert workflow requires unnecessary repeated steps
```

## Medium

Creates noticeable cognitive or interaction cost but does not normally block completion.

Examples:

```
vague label
weak hierarchy
excessive modal use
secondary information competing with primary information
```

## Low

Minor friction or inconsistency with limited task impact.

Examples:

```
inconsistent secondary terminology
slightly redundant metadata
noncritical discoverability issue
```

## Cosmetic

Primarily affects polish rather than comprehension or completion.

Examples:

```
inconsistent radius
minor alignment issue
low-impact visual rhythm issue
```

Do not exaggerate severity.

Do not downgrade accessibility barriers to cosmetic issues.

---

# 37. Severity Factors

When deciding severity, consider:

```
Impact
Frequency
Reach
Recoverability
Risk
```

A small friction repeated hundreds of times per day may deserve higher priority than a visually dramatic issue encountered once per year.

A rare destructive error may also deserve high priority because its consequence is severe.

---

# 38. Required Finding Format

Every meaningful issue should follow:

## Evidence

What is observable in the interface?

Avoid vague judgment.

## Problem

Which usability or design principle is failing?

## Consequence

What does the user have to think, remember, search for, redo, or risk because of the problem?

## Fix

What specific change addresses the cause?

Example:

### High — Primary action has no clear hierarchy

**Evidence**

Deploy, Logs, Duplicate, Settings, and Delete appear with nearly equal visual weight.

**Problem**

The action hierarchy does not match the primary task.

**Consequence**

Users must read and interpret every action instead of immediately recognizing the main next step.

**Fix**

Make Deploy the primary action. Keep Logs and Settings secondary. Move rare actions such as Duplicate into a lower-prominence menu and visually separate Delete.

---

# 39. Avoid Subjective Findings

Bad review:

> This looks ugly.

Bad review:

> The cards feel boring.

Bad review:

> I don't like this blue.

Better:

> The five equal-weight cards force the user to scan all five before identifying the only card that contains an actionable problem.

Better:

> Secondary metadata uses the same weight and contrast as the item's primary state, reducing scan speed.

Tie criticism to observable user impact whenever possible.

---

# 40. Smallest Effective Fix

Do not redesign more than necessary.

Use this escalation ladder:

```
copy
  ↓
labeling
  ↓
visual hierarchy
  ↓
component
  ↓
layout
  ↓
interaction
  ↓
workflow
  ↓
information architecture
  ↓
product model
```

Choose the lowest level that fixes the underlying problem.

Example:

Problem:

```
"Manage" is ambiguous.
```

Likely fix:

```
rename to "Team members"
```

Do not redesign the entire navigation.

But if all navigation reflects backend entities, a structural IA fix may be justified.

---

# 41. Preserve What Works

A review should identify strengths that should not be accidentally destroyed.

Before refactoring, identify:

```
useful terminology
familiar interactions
efficient density
stable navigation
effective keyboard behavior
strong table structure
helpful defaults
established user habits
```

Do not redesign functioning patterns simply to produce visible change.

Existing user knowledge has value.

---

# 42. Refactor Mode Workflow

When the review is followed by implementation:

## Step 1 — Review

Identify the highest-impact issues.

## Step 2 — Define desired behavior

Describe what should become easier for the user.

## Step 3 — Choose minimum scope

Decide whether the fix requires:

```
copy
styling
component change
layout change
interaction change
workflow change
IA change
```

## Step 4 — Implement

Preserve the existing design system and code conventions when possible.

## Step 5 — Check states

Verify:

```
default
loading
empty
success
error
disabled
permission
responsive
keyboard
```

as relevant.

## Step 6 — Review again

Ask:

> Did the change reduce actual user effort?

Do not stop at:

> It looks cleaner.

---

# 43. Post-Refactor Regression Check

After changing the UI, ensure the fix did not introduce:

```
lower information density
hidden expert actions
additional clicks
lost keyboard access
reduced accessibility
inconsistent terminology
broken responsive behavior
lost context
unnecessary confirmation
new ambiguity
```

Every simplification has a cost.

Verify the tradeoff.

---

# 44. Standard Review Output

Unless a different format is specified, write:

# UI Review

## User & Task

Briefly state:

```
primary user
primary goal
primary task
relevant assumptions
```

## Overall Diagnosis

Give 2–4 sentences describing the underlying design quality.

Do not start with cosmetic comments.

## Highest-Priority Findings

List Critical and High findings first.

Each finding uses:

```
Evidence
Problem
Consequence
Fix
```

## Other Findings

Include Medium, Low, and Cosmetic findings only when useful.

## Interaction Tax

Summarize the largest unnecessary costs:

```
finding
interpreting
remembering
entering
switching
waiting
confirming
recovery
```

## What Already Works

Identify useful patterns worth preserving.

## Recommended Refactor Order

Give an ordered implementation sequence.

Example:

```
1. Fix navigation language.
2. Restore primary-action hierarchy.
3. Reduce repeated form entry.
4. Improve error recovery.
5. Clean up cosmetic card styling.
```

This prevents teams from polishing the wrong structure.

---

# 45. Concise Review Mode

For a small surface or a limited-scope review, the report may use:

| Severity | Issue | User impact | Recommended fix |
| -------- | ----- | ----------- | --------------- |

Do not force the full report when the UI has only a few meaningful issues.

---

# 46. Visual Screenshot Review

When only screenshots are available:

Review what can be observed:

```
hierarchy
terminology
navigation
grouping
density
affordance
visible state
apparent task model
accessibility risks
```

Do not claim to know:

```
actual keyboard behavior
screen reader behavior
actual loading behavior
hidden interactions
performance
persistence
```

Mark these as needing implementation verification.

---

# 47. Code Review

When implementation code is available, additionally inspect:

```
semantics
heading structure
form labels
focus behavior
keyboard handling
accessible names
ARIA usage
responsive implementation
loading states
error states
empty states
disabled states
destructive actions
unnecessary custom controls
```

Prefer native semantic elements when practical.

Do not fix accessibility solely by adding ARIA to an inappropriate custom control when a native control would solve the problem better.

---

# 48. Review Against `user-language-ui.md`

Treat [`user-language-ui.md`](./user-language-ui.md) as upstream design intent.

Check whether the implementation preserves:

```
user vocabulary
user task model
mental model
information hierarchy
disclosure strategy
expert efficiency
feedback
accessibility
```

The relationship is:

```
docs/user-language-ui.md
    = how the experience should be designed

docs/ui-review.md
    = whether the implementation actually satisfies that intent
```

Do not duplicate upstream rules unnecessarily.

Use them as evaluation criteria.

---

# 49. Final Review Questions

Before completing a review, answer:

### User

Who is this for?

### Goal

Why did they open this screen?

### Orientation

Can they tell where they are?

### Priority

Can they tell what matters?

### Action

Can they find what to do?

### Prediction

Can they predict what will happen?

### Feedback

Can they tell what happened?

### Recovery

Can they recover from mistakes?

### Memory

Are they forced to remember unnecessary information?

### Efficiency

Are frequent tasks fast enough?

### Density

Is complexity useful or accidental?

### Accessibility

Can different users and input methods operate it?

### Responsiveness

Does task priority survive smaller screens?

### Language

Does the interface speak the user's language or the software's language?

### Visual quality

Does visual design clarify meaning rather than decorate confusion?

### AI smell

Does any part exist mainly because generated interfaces commonly contain it?

If several answers are unclear, the review is incomplete.

---

# 50. Final Principle

A UI review is not an aesthetic opinion.

It is a diagnosis of friction between:

```
what the user wants
        and
what the interface requires
```

The reviewer must locate that friction.

Then explain:

```
where it occurs
why it occurs
what it costs the user
how important it is
how to remove it
```

The purpose is not to make the interface look different.

The purpose is to make the interaction require less unnecessary work.

**Review the task before the screen.
Review the hierarchy before the decoration.
Fix causes before symptoms.
Preserve useful complexity.
Remove accidental complexity.**
