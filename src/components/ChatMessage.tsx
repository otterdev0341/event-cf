interface ChatMessageProps {
  children: string;
  side: "agent" | "user";
}

export function ChatMessage({ children, side }: ChatMessageProps) {
  return (
    <div className={`chat-message chat-message--${side}`}>
      <p>{children}</p>
    </div>
  );
}
