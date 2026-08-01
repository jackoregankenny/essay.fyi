//! Skills: standing instructions handed to the agent, not code that runs.
//!
//! Two kinds, and they answer different questions.
//!
//! The **house skill** answers "what is this place?". An agent arriving in a
//! session has no idea it is working on a manuscript rather than a codebase,
//! that the file is the product rather than a build input, or that its edits
//! are going to be read as a diff by the person who wrote the prose. It is
//! built in, always sent, and not the author's business to maintain.
//!
//! **Preference skills** answer "how does this author write?" — voice,
//! spelling, the things a house style would cover. They are files, because
//! invariant 1 says the interesting state is files: editable in Essay itself,
//! diffable, shareable, and deletable without breaking anything.
//!
//! Neither *enforces* anything, and the naming should not pretend otherwise.
//! A skill shapes what the agent is likely to do; `essay-diff` and the review
//! surface are what stop an unwanted result being accepted. Declaring
//! `scope: section` is useful precisely because it is machine-checkable
//! afterwards, not because the agent is obliged to honour it.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// What a skill claims it will confine itself to. Recorded so the review
/// surface can check the claim against the diff.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillScope {
    /// Expected to touch one section. A change that touches more is worth
    /// flagging, not blocking.
    Section,
    #[default]
    Document,
}

impl SkillScope {
    fn parse(value: &str) -> Self {
        match value.trim() {
            "section" => Self::Section,
            _ => Self::Document,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// Stable id — the file stem, or `essay` for the house skill.
    pub id: String,
    pub name: String,
    pub scope: SkillScope,
    /// Everything after the front matter: what the agent is actually told.
    pub body: String,
    /// Absent for the built-in.
    pub path: Option<String>,
    pub built_in: bool,
}

/// The house skill. Embedded rather than written to disk on first run: it
/// describes how *Essay* works, so it belongs to the application and should
/// change when the application does, not sit stale in someone's folder.
const HOUSE_BODY: &str = "\
You are working inside Essay, a writing application. The file you have been \
given is a manuscript — someone's actual prose — not source code.

What that changes:

- The file is the finished product, not an input to a build. Formatting you \
  would normally tidy is the author's decision. Do not reflow paragraphs, \
  renumber lists, realign table columns, or reformat anything you were not \
  asked to change.
- Edit surgically. Read the section you were asked about and change that. Do \
  not rewrite or regenerate the whole document, even if the result would be \
  an improvement — the author's sentences are the point, and a wholesale \
  rewrite is rejected on sight.
- The author reads every change as a diff before it is applied. Small, \
  legible edits get accepted; sprawling ones get thrown away. Working \
  narrowly is in your interest.
- Say what you changed and why, in one short sentence per edit. That \
  explanation is shown next to the diff.
- Do not add new claims, citations, statistics or names. If a passage needs \
  evidence the author has not supplied, say so instead of inventing it.
- Preserve the author's voice, register and idiom, including their spelling \
  conventions. You are editing their writing, not producing your own.";

pub fn house_skill() -> Skill {
    Skill {
        id: "essay".into(),
        name: "Working in Essay".into(),
        scope: SkillScope::Document,
        body: HOUSE_BODY.into(),
        path: None,
        built_in: true,
    }
}

/// Where an author's own skills live beside a document.
pub fn skills_dir(document: &Path) -> Option<PathBuf> {
    document.parent().map(|dir| dir.join(".essay").join("skills"))
}

/// Read the skills available to a document: the house skill first, then any
/// files in `.essay/skills/`, alphabetically.
///
/// A malformed skill is skipped rather than failing the load — a bad file in
/// a folder should not stop an author talking to an agent.
pub fn load_skills(document: &Path) -> Vec<Skill> {
    let mut skills = vec![house_skill()];
    let Some(dir) = skills_dir(document) else {
        return skills;
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return skills;
    };

    let mut found: Vec<Skill> = entries
        .flatten()
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        })
        .filter_map(|entry| {
            let source = std::fs::read_to_string(entry.path()).ok()?;
            parse_skill(&source, &entry.path())
        })
        .collect();
    found.sort_by(|a, b| a.id.cmp(&b.id));
    skills.extend(found);
    skills
}

fn parse_skill(source: &str, path: &Path) -> Option<Skill> {
    let id = path.file_stem()?.to_string_lossy().to_string();
    let (front, body) = split_front_matter(source);
    let field = |key: &str| {
        front.lines().find_map(|line| {
            let (k, v) = line.split_once(':')?;
            (k.trim() == key).then(|| v.trim().to_string())
        })
    };
    let body = body.trim().to_string();
    if body.is_empty() {
        return None;
    }
    Some(Skill {
        name: field("name").unwrap_or_else(|| id.clone()),
        scope: field("scope").map(|s| SkillScope::parse(&s)).unwrap_or_default(),
        id,
        body,
        path: Some(path.display().to_string()),
        built_in: false,
    })
}

/// Front matter here is a convenience for the author, not a fidelity concern —
/// nothing round-trips a skill file, so a simple split is enough.
fn split_front_matter(source: &str) -> (&str, &str) {
    let rest = match source.strip_prefix("---\n") {
        Some(rest) => rest,
        None => match source.strip_prefix("---\r\n") {
            Some(rest) => rest,
            None => return ("", source),
        },
    };
    match rest.find("\n---") {
        Some(end) => {
            let after = &rest[end + 4..];
            (&rest[..end], after.strip_prefix('\n').unwrap_or(after))
        }
        None => ("", source),
    }
}

/// Build the text sent to the agent.
///
/// The skills go in once, on the first turn of a session, and the agent keeps
/// them in context after that. Repeating them every turn would spend the
/// author's subscription tokens to say something already said.
pub fn compose_prompt(skills: &[Skill], instruction: &str, first_turn: bool) -> String {
    if !first_turn || skills.is_empty() {
        return instruction.to_string();
    }
    let mut out = String::new();
    for skill in skills {
        out.push_str(&skill.body);
        out.push_str("\n\n");
    }
    out.push_str("---\n\n");
    out.push_str(instruction);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, name: &str, contents: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(name), contents).unwrap();
    }

    #[test]
    fn the_house_skill_is_always_available() {
        let dir = tempfile::tempdir().unwrap();
        let skills = load_skills(&dir.path().join("essay.md"));
        assert_eq!(skills.len(), 1);
        assert!(skills[0].built_in);
        assert!(skills[0].body.contains("manuscript"));
    }

    #[test]
    fn an_authors_skills_are_read_from_the_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("essay.md");
        write(
            &skills_dir(&doc).unwrap(),
            "tighten.md",
            "---\nname: Tighten\nscope: section\n---\n\nCut hedging.\n",
        );

        let skills = load_skills(&doc);
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[1].id, "tighten");
        assert_eq!(skills[1].name, "Tighten");
        assert_eq!(skills[1].scope, SkillScope::Section);
        assert_eq!(skills[1].body, "Cut hedging.");
        assert!(!skills[1].built_in);
    }

    #[test]
    fn a_skill_without_front_matter_is_still_a_skill() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("essay.md");
        write(&skills_dir(&doc).unwrap(), "voice.md", "Write plainly.\n");

        let skills = load_skills(&doc);
        assert_eq!(skills[1].name, "voice", "falls back to the file name");
        assert_eq!(skills[1].scope, SkillScope::Document);
    }

    #[test]
    fn an_empty_skill_is_skipped_rather_than_sent() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("essay.md");
        write(&skills_dir(&doc).unwrap(), "blank.md", "---\nname: Blank\n---\n\n");

        assert_eq!(load_skills(&doc).len(), 1, "house skill only");
    }

    #[test]
    fn skills_are_sent_once_not_every_turn() {
        let skills = vec![house_skill()];
        let first = compose_prompt(&skills, "Tighten section three.", true);
        assert!(first.contains("manuscript"));
        assert!(first.ends_with("Tighten section three."));

        let second = compose_prompt(&skills, "Now the conclusion.", false);
        assert_eq!(second, "Now the conclusion.");
    }

    #[test]
    fn preferences_follow_the_house_skill() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("essay.md");
        write(
            &skills_dir(&doc).unwrap(),
            "spelling.md",
            "---\nname: Spelling\n---\n\nBritish spelling throughout.\n",
        );

        let skills = load_skills(&doc);
        let composed = compose_prompt(&skills, "Go.", true);
        let house = composed.find("manuscript").unwrap();
        let pref = composed.find("British spelling").unwrap();
        assert!(house < pref, "the author's preferences come last, so they win");
    }
}
