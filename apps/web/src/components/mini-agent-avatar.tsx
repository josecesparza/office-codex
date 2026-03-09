import type { CSSProperties } from "react";

interface MiniAgentAvatarProps {
  color: string;
  label: string;
  variant?: number;
}

export function MiniAgentAvatar(props: MiniAgentAvatarProps) {
  const eyeOffset = props.variant === 2 ? 1 : 0;
  const shoulderWidth = props.variant === 1 ? 10 : 8;

  return (
    <span
      aria-label={props.label}
      className="mini-agent-avatar"
      style={
        {
          "--mini-agent-color": props.color,
          "--mini-agent-eye-offset": `${eyeOffset}px`,
          "--mini-agent-shoulder-width": `${shoulderWidth}px`,
        } as CSSProperties
      }
    >
      <span className="mini-agent-avatar-head" />
      <span className="mini-agent-avatar-body" />
      <span className="mini-agent-avatar-eye mini-agent-avatar-eye-left" />
      <span className="mini-agent-avatar-eye mini-agent-avatar-eye-right" />
    </span>
  );
}
