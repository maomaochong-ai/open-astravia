export const LINUX_RELEASE_TARGETS = Object.freeze(["AppImage", "deb", "rpm"]);

export const LINUX_RELEASE_EXTENSIONS = Object.freeze([".AppImage", ".deb", ".rpm"]);

export const LINUX_PACKAGE_METADATA = Object.freeze({
	author: Object.freeze({
		name: "OpenVetta",
		email: "openvetta@users.noreply.github.com",
	}),
	homepage: "https://github.com/openvetta/open-vetta",
	license: "Apache-2.0",
	maintainer: "OpenVetta <openvetta@users.noreply.github.com>",
	vendor: "OpenVetta",
});
