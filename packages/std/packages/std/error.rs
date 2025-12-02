use anstream::eprintln;
use crossterm::style::Stylize as _;
use std::fmt::Write as _;
use tangram_client::prelude::*;

/// Print an error with all its rich information including source chain, locations, diagnostics, etc.
pub fn print_error(error: tg::Error) {
	let error = tg::Referent::with_item(error);
	print_error_referent(error);
}

/// Print an error referent with all its rich information.
pub fn print_error_referent(error: tg::Referent<tg::Error>) {
	let mut stack = vec![error];

	while let Some(error) = stack.pop() {
		let (referent, error) = error.replace(());

		// Print the message.
		let message = error.message.as_deref().unwrap_or("an error occurred");
		eprintln!("{} {}", "->".red(), message.replace('\n', "\n   "));

		// Print the values.
		for (key, value) in &error.values {
			let key = key.as_str();
			let value = value.as_str();
			eprintln!("   {key} = {value}");
		}

		// Print the location.
		if let Some(mut location) = error.location {
			if let tg::error::File::Module(module) = &mut location.file {
				module.referent.inherit(&referent);
			}
			print_error_location(&location);
		}

		// Print the stack.
		for mut location in error.stack.into_iter().flatten() {
			if let tg::error::File::Module(module) = &mut location.file {
				module.referent.inherit(&referent);
			}
			print_error_location(&location);
		}

		// Print the diagnostics.
		for mut diagnostic in error.diagnostics.into_iter().flatten() {
			if let Some(location) = &mut diagnostic.location {
				location.module.referent.inherit(&referent);
			}
			let severity = match diagnostic.severity {
				tg::diagnostic::Severity::Error => "error",
				tg::diagnostic::Severity::Warning => "warning",
				tg::diagnostic::Severity::Info => "info",
				tg::diagnostic::Severity::Hint => "hint",
			};
			eprintln!("{} {}", severity, diagnostic.message);
			if let Some(location) = &diagnostic.location {
				print_location(&location.module, &location.range);
			}
		}

		// Add the source to the stack.
		if let Some(source) = error.source {
			let mut source = source.map(|item| *item);
			source.inherit(&referent);
			stack.push(source);
		}
	}
}

fn print_error_location(location: &tg::error::Location) {
	match &location.file {
		tg::error::File::Internal(path) => {
			eprintln!(
				"   internal:{}:{}:{}",
				path.display(),
				location.range.start.line + 1,
				location.range.start.character + 1
			);
		},
		tg::error::File::Module(module) => {
			print_location(module, &location.range);
		},
	}
}

fn print_location(module: &tg::Module, range: &tg::Range) {
	match &module.referent.item {
		tg::module::Item::Path(path) => {
			eprint!(
				"   {}:{}:{}",
				path.display(),
				range.start.line + 1,
				range.start.character + 1,
			);
			eprintln!();
		},
		tg::module::Item::Edge(_edge) => {
			let mut title = String::new();
			if let Some(tag) = module.referent.tag() {
				write!(title, "{tag}").unwrap();
				if let Some(path) = module.referent.path() {
					write!(title, ":{}", path.display()).unwrap();
				}
			} else if let Some(path) = module.referent.path() {
				if path
					.components()
					.next()
					.is_some_and(|component| matches!(component, std::path::Component::Normal(_)))
				{
					write!(title, "./").unwrap();
				}
				write!(title, "{}", path.display()).unwrap();
			} else {
				write!(title, "<unknown>").unwrap();
			}
			eprint!(
				"   {title}:{}:{}",
				range.start.line + 1,
				range.start.character + 1,
			);
			eprintln!();
		},
	}
}
