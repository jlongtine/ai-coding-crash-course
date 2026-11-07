---
name: lesson-checkpoints
description: Lesson checkpoint commits on `live-run-through` — slug prefixes, and why existing slugs stay fixed. Use when rewording, reordering, squashing, or rebasing commits.
---

# Lesson Checkpoints

This repo is the exercise project for a course. `main` is the student starting point; each lesson's checkpoint is one commit on `live-run-through`, its message prefixed with the lesson's slug: `<slug>: <summary>`.

Students navigate by slug through `ai-hero-cli`:

- `npm run reset <slug>` — hard-reset to a lesson checkpoint
- `npm run cherry-pick <slug>` — apply one lesson's commit onto current work
- `npm run pull` — pull upstream `main` into the working branch

Slugs are a public interface: the CLI looks them up and recorded videos say them aloud. When rewriting history, carry every existing slug through unchanged, character for character — reword only the summary after the colon. A new lesson gets a new slug; a squash keeps the slug of the lesson the result represents.
