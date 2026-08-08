# Voyage

**A personal productivity dashboard — notes, habits, tasks, goals, calendar, and a focus timer, all in one place.**

---

## Why this exists

Staying productive usually means juggling four or five separate apps: a notes app, a habit tracker, a to-do list, a calendar, and a timer — each with its own login, its own layout, its own tab to switch to. None of them talk to each other. You check off a habit in one app and have no idea whether that connects to anything you're actually working toward in another.

That fragmentation was the actual problem: **not a lack of tools, but too many disconnected ones.** Every context switch between apps is a small tax on focus, and none of the existing tools were shaped around one person's actual daily rhythm — they're built for the average user, not for how *you* specifically plan a day.

Voyage was built to solve that by putting everything in a single, connected system:

- **One dashboard** that shows today's tasks, today's habits, upcoming events, notes, and weekly progress at a glance — no tab-switching required.
- **Real connections between features**, not just proximity. Checking off a habit or completing a task actually feeds the weekly progress graph and the daily streak — the app reflects genuine activity instead of static, disconnected widgets.
- **A habit tracker shaped like a paper habit sheet** (rows of habits, columns of days, a running points total) because that grid format is a well-worn, effective way to see a month of consistency at a glance — reproduced digitally instead of forcing habits into a generic checklist.
- **Everything local and private.** Voyage is intentionally front-end only — all data lives in the browser's local storage. Nothing is sent to a server, so there's no account to create and no data leaving your machine.

## What problem it solves, concretely

| Before (scattered tools) | With Voyage |
|---|---|
| Habit app, to-do app, notes app, calendar app — 4+ logins | One dashboard, zero logins |
| Streaks and progress tracked nowhere, or tracked per-app in isolation | A single streak that counts activity from *either* tasks or habits |
| To-do lists that either never reset or lose history when they do | Tasks reset automatically each day, with full day-by-day history still browsable |
| Generic checklist-style habit trackers that don't show a month at a glance | A monthly grid tracker, closer to a real habit sheet, with a running points total per day |
| No connection between "what I did" and "how I'm trending" | A weekly progress graph built directly from real task and habit data, not sample numbers |

## Features

- **Dashboard** — daily overview: tasks, habits, upcoming events, quick notes, and weekly progress
- **To-Do** — daily task list with day-by-day history you can browse back through
- **Habit Tracker** — monthly grid tracker (auto-updates each new month) plus a quick daily checklist
- **Goals** — track progress toward longer-term targets
- **Calendar** — month view with upcoming/past event separation
- **Notes** — quick capture, tag-labeled note cards
- **Focus Timer** — flip-clock style timer with a plain stopwatch mode and a Pomodoro mode
- **Streak** — computed from real activity: complete at least one task or habit in a day to keep it alive

## Tech

Plain HTML, CSS, and JavaScript — no framework, no build step, no backend. Data persists in the browser via `localStorage`. Open `voyage.html` in any modern browser and it just works.

## Status

This is a personal project, actively evolving based on real day-to-day use rather than built to a fixed spec upfront — features have been added and reshaped as actual usage revealed what was missing or what didn't fit how the day actually goes.
