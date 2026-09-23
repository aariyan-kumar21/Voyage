# Voyage

**Your day, actually in sync with itself.**

Voyage is a unified productivity dashboard that replaces the scattered mess of disconnected apps — one focused command center where your tasks, habits, notes, time, and goals live together, and where your progress is a reflection of what you actually did, not what you remembered to log.

**Live demo:** [voyagetracker.vercel.app](https://voyagetracker.vercel.app/)

---

## The Problem

Modern productivity setups are fragmented by default. A to-do app for tasks. A separate habit tracker for consistency. A notes app for thoughts. A timer app for focus sessions. A calendar for events. None of them talk to each other, and none of them know what you actually accomplished today without you manually telling each one, separately, every time.

The result is a strange irony: apps built to reduce friction end up creating an administrative burden of their own — updating five interfaces just to feel organized in one life.

Voyage exists to close that gap.

## What Makes Voyage Different

Most productivity tools fall into one of two categories: rigid single-purpose trackers, or blank-canvas workspaces like Notion that hand you total flexibility but zero structure — every dashboard, database, and habit tracker has to be built by hand before it's useful.

Voyage takes a third path.

- **It is built, not blank.** Open Voyage and your day is already structured — no templates to configure, no databases to design. The dashboard, tracker, and planner exist from the first login.
- **Your numbers are earned, not typed.** In most trackers, a streak or a completion percentage is just a manually maintained figure — nothing stops it from being fiction. In Voyage, every number on the dashboard is computed live, directly from your actual to-do completions and habit check-ins. There is no field to manually inflate.
- **The goal planner is a coach, not a text box.** Instead of a static "Goals" list where you type a percentage yourself, Voyage's AI-powered planner holds an actual conversation with you — asking about your experience, your timeframe, and your constraints — and produces a real, sequenced, checkable roadmap tailored to what you told it.
- **One surface, not five tabs.** Tasks, habits, notes, a focus timer, a calendar, and an AI goal roadmap all live inside a single connected dashboard, not a set of app icons competing for your attention.

## What's the use AI chatbot here

Setting a goal is easy. Knowing the *right order* to pursue it in is not. Voyage's planner removes the paralysis of "where do I even start" by doing the sequencing work for you — accounting for what you already know, how much time you actually have, and what genuinely needs to happen before the next step makes sense. It turns a vague ambition like "I want to learn full-stack development" into a concrete, ordered, milestone-by-milestone path you can act on immediately.

## Technology

<p align="left">
  <img src="https://skillicons.dev/icons?i=html,css,js,nodejs,mongodb,vercel" alt="Tech stack icons" />
</p>

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript, HTML, CSS — no framework overhead |
| Backend | Vercel Serverless Functions (Node.js) |
| Database | MongoDB Atlas |
| Authentication | Custom auth with bcrypt password hashing and httpOnly cookie sessions |
| AI | Google Gemini API |
| Hosting | Vercel |

## Philosophy

Voyage was built on a simple conviction: a productivity tool should reflect reality, not require you to perform it. Every design decision — from computing streaks off real activity instead of manual toggles, to building an AI planner that produces genuine structure instead of decoration — traces back to that principle.

This is not another blank canvas asking you to build your own system from scratch. It is a system, ready from the first day, built to move with you.
