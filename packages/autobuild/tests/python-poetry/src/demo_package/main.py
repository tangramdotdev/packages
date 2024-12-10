def get_message() -> str:
    return "Hello world!"

def main() -> None:
    """Entry point for the application."""
    message = get_message()
    print(message)

if __name__ == "__main__":
    main()
