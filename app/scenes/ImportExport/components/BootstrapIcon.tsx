import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCloudArrowUp,
  faCheckCircle,
  faExclamationCircle,
  faCircleXmark,
  faFile,
  faMagnifyingGlass,
  faDownload,
  faArrowRight,
  faArrowLeft,
  faUpload,
  faHourglass,
  faCheck,
  faCheckCircle as faCheckCircleFill,
  faRotateLeft,
  faForward,
  faFilePdf,
  faFileLines,
  faFileImage,
  faFileZipper,
  faStar,
  faFileAlt,
} from "@fortawesome/free-solid-svg-icons";

export type BootstrapIconName =
  | "cloud-upload"
  | "check-circle"
  | "exclamation-circle"
  | "x-circle"
  | "file-earmark"
  | "search"
  | "download"
  | "arrow-right"
  | "arrow-left"
  | "upload"
  | "hourglass"
  | "check"
  | "check-circle-fill"
  | "hourglass-split"
  | "arrow-counterclockwise"
  | "forward"
  | "file-pdf"
  | "file-text"
  | "file-image"
  | "file-earmark-zip"
  | "sparkles"
  | "document";

interface BootstrapIconProps {
  name: BootstrapIconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

// Mapping bootstrap icon names to FontAwesome icons
const iconMap: Record<BootstrapIconName, any> = {
  "cloud-upload": faCloudArrowUp,
  "check-circle": faCheckCircle,
  "exclamation-circle": faExclamationCircle,
  "x-circle": faCircleXmark,
  "file-earmark": faFile,
  search: faMagnifyingGlass,
  download: faDownload,
  "arrow-right": faArrowRight,
  "arrow-left": faArrowLeft,
  upload: faUpload,
  hourglass: faHourglass,
  check: faCheck,
  "check-circle-fill": faCheckCircleFill,
  "hourglass-split": faHourglass,
  "arrow-counterclockwise": faRotateLeft,
  forward: faForward,
  "file-pdf": faFilePdf,
  "file-text": faFileLines,
  "file-image": faFileImage,
  "file-earmark-zip": faFileZipper,
  sparkles: faStar,
  document: faFileAlt,
};

export const BootstrapIcon: React.FC<BootstrapIconProps> = ({
  name,
  size = 16,
  className = "",
  style = {},
}) => {
  const icon = iconMap[name];

  if (!icon) {
    return null;
  }

  return (
    <FontAwesomeIcon
      icon={icon}
      style={{
        fontSize: `${size}px`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
      className={className}
    />
  );
};

export default BootstrapIcon;
