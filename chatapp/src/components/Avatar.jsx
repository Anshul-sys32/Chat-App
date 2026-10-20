import { useEffect, useState } from "react";
import { FaUser, FaUsers } from "react-icons/fa";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";

export default function Avatar({ src, name = "", className = "", group = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = src
    ? src.startsWith("/") ? `${API_URL}${src}` : src
    : "";

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-teal-500/15 text-teal-100 ${className}`}>
      {imageUrl && !imageFailed ? (
        <img
          src={imageUrl}
          alt={`${name || (group ? "Group" : "User")} profile`}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        name ? name.charAt(0).toUpperCase() : group ? <FaUsers aria-hidden="true" /> : <FaUser aria-hidden="true" />
      )}
    </span>
  );
}
