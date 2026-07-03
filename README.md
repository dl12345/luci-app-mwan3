# luci-app-mwan3

LuCI support for the MWAN3 MultiWAN Manager.

### Build

Add both `mwan3` and `luci-app-mwan3` to `feeds.conf`, then update and install
the feeds before selecting the packages.

```conf
# feeds.conf
src-git openwrt_mwan3 https://github.com/dl12345/mwan3.git;openwrt-25.12
src-git luci_app_mwan3 https://github.com/dl12345/luci-app-mwan3.git;openwrt-25.12
```

```sh
./scripts/feeds update mwan3 luci_app_mwan3
./scripts/feeds install -a -p mwan3
./scripts/feeds install -a -p luci_app_mwan3
```
