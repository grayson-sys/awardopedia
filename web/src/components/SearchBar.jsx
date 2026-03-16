"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export default function SearchBar({ initialValue = "", onSearch, placeholder }) {
  const [query, setQuery] = useState(initialValue);
  const router = useRouter();

  function handleSubmit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (onSearch) {
      onSearch(q);
    } else {
      router.push(`/awards?q=${encodeURIComponent(q)}`);
    }
  }

  return (
    <form className="search-bar" onSubmit={handleSubmit} role="search">
      <input
        className="search-bar__input"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder || "Search awards, agencies, contractors..."}
        aria-label="Search awards"
      />
      <button className="search-bar__button" type="submit">
        <Search size={16} />
        Search
      </button>
    </form>
  );
}
