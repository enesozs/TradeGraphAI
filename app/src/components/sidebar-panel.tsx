import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Lets a page (e.g. the Trade map) put its controls into the sidebar instead of floating them over the canvas.
// The shell renders an empty slot; the page portals its controls into it. Only registration (mount/unmount)
// touches shared state, so page re-renders never loop through the shell.
type Ctx = {
  title: string | null;
  register: (title: string) => void;
  unregister: () => void;
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
  showNav: boolean;
  setShowNav: (v: boolean) => void;
};

const SidebarPanelContext = createContext<Ctx | null>(null);

export function SidebarPanelProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [showNav, setShowNav] = useState(false);
  const register = (t: string) => {
    setTitle(t);
    setShowNav(false);
  };
  const unregister = () => setTitle(null);
  return (
    <SidebarPanelContext.Provider value={{ title, register, unregister, slot, setSlot, showNav, setShowNav }}>{children}</SidebarPanelContext.Provider>
  );
}

export function useSidebarPanelState(): Ctx {
  const ctx = useContext(SidebarPanelContext);
  if (!ctx) throw new Error("useSidebarPanelState must be used inside SidebarPanelProvider");
  return ctx;
}

export function SidebarPanel({ title, children }: { title: string; children: ReactNode }) {
  const { register, unregister, slot, showNav } = useSidebarPanelState();
  useLayoutEffect(() => {
    register(title);
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);
  return slot && !showNav ? createPortal(children, slot) : null;
}
