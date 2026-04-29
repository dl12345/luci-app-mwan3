#
# Copyright (C) 2017 Dan Luedtke <mail@danrl.com>
#
# This is free software, licensed under the GNU General Public License v2.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for the MWAN3 MultiWAN Manager
LUCI_DEPENDS:=+luci-base +mwan3
PKG_LICENSE:=GPL-2.0
PKG_SRC_PREFIX:=$(shell date +%y).999
PKG_SRC_SUFFIX:=3.5
PKG_VERSION:=$(PKG_SRC_PREFIX).$(PKG_SRC_SUFFIX)
PKG_RELEASE:=1

PKG_MAINTAINER:=Florian Eckert <fe@dev.tdt.de>

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
