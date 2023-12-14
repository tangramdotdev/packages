use clap::Parser;
use std::os::unix::process::CommandExt;

#[derive(Debug, Parser)]
struct Args {
	/// Set this arg to activate the environment in a shell. The default value is `sh`.
	#[arg(long)]
	#[allow(clippy::option_option)]
	activate: Option<Option<Shell>>,

	/// The command to run.
	trailing_args: Vec<String>,
}

#[derive(Debug, Clone, Copy, clap::ValueEnum)]
enum Shell {
	Sh,
	Bash,
	Zsh,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
	// Parse the args.
	let args = Args::parse();

	if let Some(shell) = args.activate {
		// If the activate arg is present, then print the activate script.
		activate(shell.unwrap_or(Shell::Sh));
		Ok(())
	} else if args.trailing_args.is_empty() {
		// If there are no trailing args, then print the environment.
		for (name, value) in std::env::vars() {
			println!("{name}={value}");
		}
		Ok(())
	} else {
		// Otherwise, exec the command.
		let mut args = args.trailing_args.into_iter();
		let executable = args.next().unwrap();
		Err(std::process::Command::new(executable)
			.args(args)
			.exec()
			.into())
	}
}

fn activate(shell: Shell) {
	match shell {
		Shell::Sh | Shell::Bash | Shell::Zsh => {
			std::env::vars().for_each(|(name, value)| activate_var_posix(&name, &value));
		},
	}
}

fn activate_var_posix(name: &str, value: &str) {
	// Ensure the name is valid.
	assert!(
		env_name_is_valid_posix(name),
		r#"Invalid environment variable name "{name}"."#
	);

	// Encode the value.
	let encoded_value = encode_env_value_posix(value);

	// Print the export.
	println!("export {name}=\"{encoded_value}\"");
}

fn env_name_is_valid_posix(name: &str) -> bool {
	// Ensure the name is not empty.
	let Some(first_char) = name.chars().next() else {
		return false;
	};

	// The first character must be a letter or underscore.
	if !(first_char.is_ascii_alphabetic() || first_char == '_') {
		return false;
	}

	// All characters must be letters, numbers, or underscores.
	if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
		return false;
	}

	true
}

fn encode_env_value_posix(value: &str) -> String {
	let mut escaped = String::new();
	for c in value.chars() {
		match c {
			// The following characters have special meaning in double quoted strings, so they must be escaped.
			'$' | '`' | '"' | '\\' | '!' => {
				escaped.push('\\');
				escaped.push(c);
			},

			// The remaining characters in this range do not need to be escaped.
			' '..='~' => {
				escaped.push(c);
			},

			// Escape all other characters using `printf` with an octal literal.
			c => {
				let literal = encode_char_literal_posix(c);
				escaped += &format!("$(printf '{literal}')");
			},
		}
	}
	escaped
}

fn encode_char_literal_posix(c: char) -> String {
	let mut encoded = [0; 4];
	let encoded = c.encode_utf8(&mut encoded);
	let encoded = encoded.as_bytes();
	let mut literal = String::new();
	for &byte in encoded {
		literal += &format!("\\0{byte:03o}");
	}
	literal
}
