"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import useMeasure from "react-use-measure";
import {
  UserIcon,
  Link01Icon,
  FolderIcon,
  File01Icon,
  SettingsIcon,
  LogoutIcon,
  MoreHorizontalCircle01Icon,
} from "@hugeicons/core-free-icons";
import { supabase } from "@/lib/supabase";
import { clearWorkspace } from "@/lib/campaigns";
import { currentPath, navigate, routes } from "@/routes";
import { useIsDev } from "@/components/WorkspaceGate";

// Change Here
const menuItems = [
  { id: "profile", label: "บัญชีของฉัน", icon: UserIcon, href: `${routes.settings}#account` },
  { id: "upgrade", label: "การเชื่อมต่อ Voice Bot", icon: Link01Icon, href: `${routes.settings}#voicebot` },
  { id: "projects", label: "แคมเปญของฉัน", icon: FolderIcon, href: routes.campaigns },
  { id: "documentation", label: "เอกสาร API", icon: File01Icon, href: routes.apiDocs },
  { id: "divider", label: "", icon: null },
  { id: "settings", label: "ตั้งค่า", icon: SettingsIcon, href: routes.settings },
  { id: "logout", label: "ออกจากระบบ", icon: LogoutIcon },
];

const easeOutQuint: [number, number, number, number] = [0.23, 1, 0.32, 1];

function pathItem() {
  const path = currentPath();
  if (path === routes.settings) return "settings";
  if (path.startsWith(routes.campaigns)) return "projects";
  return "";
}

async function logout() {
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) return;
  }
  clearWorkspace();
  window.location.assign(routes.login);
}

function runItem(item: (typeof menuItems)[number]) {
  if (item.id === "logout") { void logout(); return; }
  if (!item.href) return;
  navigate(item.href);
}

export function TwentyTwelveOne() {
  const isDev = useIsDev();
  const [isOpen, setIsOpen] = useState(false);
  const [activeItem, setActiveItem] = useState(pathItem);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [contentRef, contentBounds] = useMeasure();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const openHeight = Math.max(40, Math.ceil(contentBounds.height));
  return (
    <div ref={containerRef} className="relative h-10 w-10 not-prose">
      <motion.div
        layout
        initial={false}
        animate={{
          width: isOpen ? 220 : 40,
          height: isOpen ? openHeight : 40,
          borderRadius: isOpen ? 14 : 12,
        }}
        transition={{
          type: "spring" as const,
          damping: 34,
          stiffness: 380,
          mass: 0.8,
        }}
        className="absolute top-0 right-0 bg-popover border border-border shadow-lg overflow-hidden cursor-pointer origin-top-right "
        onClick={() => !isOpen && setIsOpen(true)}
      >
        <motion.div
          initial={false}
          animate={{
            opacity: isOpen ? 0 : 1,
            scale: isOpen ? 0.8 : 1,
          }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 flex items-center justify-center"
          role="button"
          tabIndex={isOpen ? -1 : 0}
          aria-label="เปิดเมนูบัญชี"
          aria-expanded={isOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIsOpen(true);
            }
          }}
          style={{
            pointerEvents: isOpen ? "none" : "auto",
            willChange: "transform",
          }}
        >
          <HugeiconsIcon
            icon={MoreHorizontalCircle01Icon}
            className="w-6 h-6 text-muted-foreground"
          />
        </motion.div>

        {/* Menu Content - visible when open */}
        <div ref={contentRef}>
          <motion.div
            layout
            initial={false}
            animate={{
              opacity: isOpen ? 1 : 0,
            }}
            transition={{
              duration: 0.2,
              delay: isOpen ? 0.08 : 0,
            }}
            className="p-2"
            style={{
              pointerEvents: isOpen ? "auto" : "none",
              willChange: "transform",
            }}
          >
            <ul className="flex flex-col gap-0.5 m-0! p-0! list-none!">
              {menuItems.filter(item => (item.id !== "upgrade" && item.id !== "documentation") || isDev).map((item, index) => {
                if (item.id === "divider") {
                  return (
                    <motion.hr
                      key={item.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: isOpen ? 1 : 0 }}
                      transition={{ delay: isOpen ? 0.12 + index * 0.015 : 0 }}
                      className="border-border my-1.5!"
                    />
                  );
                }

                const iconRef = item.icon!;
                const isActive = activeItem === item.id;
                const isLogout = item.id === "logout";
                const showIndicator = hoveredItem
                  ? hoveredItem === item.id
                  : isActive;

                const itemDuration = item.id === "logout" ? 0.12 : 0.15;
                const itemDelay = isOpen ? 0.06 + index * 0.02 : 0;

                return (
                  <motion.li
                    key={item.id}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{
                      opacity: isOpen ? 1 : 0,
                      x: isOpen ? 0 : 8,
                    }}
                    transition={{
                      delay: itemDelay,
                      duration: itemDuration,
                      ease: easeOutQuint,
                    }}
                    role="menuitem"
                    tabIndex={isOpen ? 0 : -1}
                    onClick={() => {
                      setActiveItem(item.id);
                      setIsOpen(false);
                      runItem(item);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveItem(item.id);
                        setIsOpen(false);
                        runItem(item);
                      }
                    }}
                    onMouseEnter={() => setHoveredItem(item.id)}
                    onMouseLeave={() => setHoveredItem(null)}
                    className={`relative flex items-center gap-3 rounded-lg text-sm cursor-pointer transition-colors duration-200 ease-out m-0! pl-3! py-2! ${
                      isLogout && showIndicator
                        ? "text-red-600"
                        : isActive
                        ? "text-foreground"
                        : isLogout
                        ? "text-muted-foreground hover:text-red-600"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {/* Hover/Active background indicator */}
                    {showIndicator && (
                      <motion.div
                        layoutId="activeIndicator"
                        className={`absolute inset-0 rounded-lg ${
                          isLogout ? "bg-red-50" : "bg-muted"
                        }`}
                        transition={{
                          type: "spring",
                          damping: 30,
                          stiffness: 520,
                          mass: 0.8,
                        }}
                      />
                    )}
                    {/* Left bar indicator */}
                    {showIndicator && (
                      <motion.div
                        layoutId="leftBar"
                        className={`absolute left-0 top-0 bottom-0 my-auto w-[3px] h-5 rounded-full ${
                          isLogout ? "bg-red-500" : "bg-foreground"
                        }`}
                        transition={{
                          type: "spring",
                          damping: 30,
                          stiffness: 520,
                          mass: 0.8,
                        }}
                      />
                    )}
                    <HugeiconsIcon
                      icon={iconRef}
                      className="w-[18px] h-[18px] relative z-10"
                    />
                    <span className="font-medium relative z-10">
                      {item.label}
                    </span>
                  </motion.li>
                );
              })}
            </ul>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

export default TwentyTwelveOne
