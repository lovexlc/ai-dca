#!/usr/bin/env bash

# 当前脚本版本号
VERSION='3.2.6'

# 环境变量用于在Debian或Ubuntu操作系统中设置非交互式（noninteractive）安装模式
export DEBIAN_FRONTEND=noninteractive

# Github 反代加速代理
GITHUB_PROXY=('https://v6.gh-proxy.org/' 'https://gh-proxy.com/' 'https://hub.glowp.xyz/' 'https://proxy.vvvv.ee/' 'https://ghproxy.lvedong.eu.org/')

trap cleanup_temp EXIT
trap on_interrupt_exit INT QUIT TERM

E[0]="\n Language:\n 1. English (default) \n 2. 简体中文"
C[0]="${E[0]}"
E[1]="fix: Resolve route conflict with WARP interface IP by narrowing CIDR range"
C[1]="fix: 通过缩小 CIDR 范围解决 WARP 接口的路由冲突"
E[2]="The script must be run as root, you can enter sudo -i and then download and run again. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[2]="必须以root方式运行脚本，可以输入 sudo -i 后重新下载运行，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[3]="The TUN module is not loaded. You should turn it on in the control panel. Ask the supplier for more help. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[3]="没有加载 TUN 模块，请在管理后台开启或联系供应商了解如何开启，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[4]="Current operating system is: \$SYSTEM, Linux Client only supports Ubuntu, Debian and CentOS. The script is aborted. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[4]="当前操作系统是: \$SYSTEM。 Linux Client 只支持 Ubuntu, Debian 和 CentOS，脚本中止，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[5]="The script supports Debian, Ubuntu, CentOS, Fedora, Arch or Alpine systems only. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[5]="本脚本只支持 Debian、Ubuntu、CentOS、Fedora、Arch 或 Alpine 系统,问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[6]="warp h (help)\n warp n (Get the WARP IP)\n warp o (Turn off WARP temporarily)\n warp u (Turn off and uninstall WARP interface and Socks5 Linux Client)\n warp b (Upgrade kernel, turn on BBR, change Linux system)\n warp v (Sync the latest version)\n warp r (Connect/Disconnect WARP Linux Client)\n warp 4/6 (Add WARP IPv4/IPv6 interface)\n warp d (Add WARP dualstack interface IPv4 + IPv6)\n warp c (Install WARP Linux Client and set to proxy mode)\n warp l (Install WARP Linux Client and set to WARP mode)\n warp i (Change the WARP IP to support Netflix)\n warp e (Install Iptables + dnsmasq + ipset solution)\n warp w (Install WireProxy solution)\n warp y (Connect/Disconnect WireProxy socks5)\n warp k (Switch between kernel and wireguard-go-reserved)\n warp g (Switch between warp global and non-global)\n warp s 4/6/d (Set stack proiority: IPv4 / IPv6 / VPS default)\n"
C[6]="warp h (帮助菜单）\n warp n (获取 WARP IP)\n warp o (临时warp开关)\n warp u (卸载 WARP 网络接口和 Socks5 Client)\n warp b (升级内核、开启BBR及DD)\n warp v (同步脚本至最新版本)\n warp r (WARP Linux Client 开关)\n warp 4/6 (WARP IPv4/IPv6 单栈)\n warp d (WARP 双栈)\n warp c (安装 WARP Linux Client，开启 Socks5 代理模式)\n warp l (安装 WARP Linux Client，开启 WARP 模式)\n warp i (更换支持 Netflix 的IP)\n warp e (安装 Iptables + dnsmasq + ipset 解决方案)\n warp w (安装 WireProxy 解决方案)\n warp y (WireProxy socks5 开关)\n warp k (切换 wireguard 内核 / wireguard-go-reserved)\n warp g (切换 warp 全局 / 非全局)\n warp s 4/6/d (优先级: IPv4 / IPv6 / VPS default)\n"
E[7]="Install dependence-list:"
C[7]="安装依赖列表:"
E[8]="All dependencies already exist and do not need to be installed additionally."
C[8]="所有依赖已存在，不需要额外安装"
E[9]="Port must be 1000-65535. Please re-input\(\${i} times remaining\):"
C[9]="端口必须为 1000-65535，请重新输入\(剩余\${i}次\):"
E[10]="wireguard-tools installation failed, The script is aborted. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[10]="wireguard-tools 安装失败，脚本中止，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[11]="Maximum \${j} attempts to get WARP IP..."
C[11]="后台获取 WARP IP 中,最大尝试\${j}次……"
E[12]="Try \${i}"
C[12]="第\${i}次尝试"
E[13]="There have been more than \${j} failures. The script is aborted. Attach the above error message. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[13]="失败已超过\${j}次，脚本中止，附上以上错误提示，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[14]="Got the WARP\$TYPE IP successfully"
C[14]="已成功获取 WARP\$TYPE 网络"
E[15]="WARP is turned off. It could be turned on again by [warp o]"
C[15]="已暂停 WARP，再次开启可以用 warp o"
E[16]="The script specifically adds WARP network interface for VPS, detailed:[https://github.com/fscarmen/warp-sh]\n Features:\n\t • Support WARP+ account. Third-party scripts is use to upgrade kernel.\n\t • Not only menus, but commands with option.\n\t • Support system: Ubuntu 16.04、18.04、20.04、22.04,Debian 9、10、11,CentOS 7、8、9, Alpine, Arch Linux 3.\n\t • Support architecture: AMD,ARM and s390x\n\t • Automatically select four WireGuard solutions. Performance: Kernel with WireGuard integration > Install kernel module > wireguard-go\n\t • Suppert WARP Linux client.\n\t • Output WARP status, IP region and asn\n"
C[16]="本项目专为 VPS 添加 warp 网络接口，详细说明: [https://github.com/fscarmen/warp-sh]\n 脚本特点:\n\t • 支持 WARP+ 账户，附带升级内核 BBR 脚本\n\t • 普通用户友好的菜单，进阶者通过后缀选项快速搭建\n\t • 智能判断操作系统: Ubuntu 、Debian 、CentOS、 Alpine 和 Arch Linux，请务必选择 LTS 系统\n\t • 支持硬件结构类型: AMD、 ARM 和 s390x\n\t • 结合 Linux 版本和虚拟化方式，自动优选4个 WireGuard 方案。网络性能方面: 内核集成 WireGuard > 安装内核模块 > wireguard-go\n\t • 支持 WARP Linux Socks5 Client\n\t • 输出执行结果，提示是否使用 WARP IP ，IP 归属地和线路提供商\n"
E[17]="Version"
C[17]="脚本版本"
E[18]="New features"
C[18]="功能新增"
E[19]="System infomation"
C[19]="系统信息"
E[20]="Operating System"
C[20]="当前操作系统"
E[21]="Kernel"
C[21]="内核"
E[22]="Architecture"
C[22]="处理器架构"
E[23]="Virtualization"
C[23]="虚拟化"
E[24]="Client is on"
C[24]="Client 已开启"
E[25]="Port change to \$PORT succeeded."
C[25]="端口成功更换至 \$PORT"
E[26]="\${MODE_BEFORE} ---> \${MODE_AFTER}, Confirm press [y] :"
C[26]="\${MODE_BEFORE} ---> \${MODE_AFTER}， 确认请按 [y] :"
E[27]="Local Socks5"
C[27]="本地 Socks5"
E[28]="Congratulations! WARP\$TYPE is turned on."
C[28]="恭喜！WARP\$TYPE 已开启"
E[29]="Input errors up to 5 times.The script is aborted."
C[29]="输入错误达5次，脚本退出"
E[30]="Client is not installed."
C[30]="Client 未安装"
E[31]="Client is installed. Disconnected."
C[31]="Client 已安装， 断开状态"
E[32]="Step 1/3: Install dependencies..."
C[32]="进度 1/3: 安装系统依赖……"
E[33]="Step 2/3: WARP configuration file has been processed"
C[33]="进度 2/3: 已处理好 WARP 配置文件"
E[34]="Failed to change port. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[34]="更换端口不成功，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[35]="Change the WARP IP to support Netflix (warp i)"
C[35]="更换支持 Netflix 的 IP (warp i)"
E[36]="1. Brush WARP IPv4\n 2. Brush WARP IPv6 (default)"
C[36]="1. 刷 WARP IPv4\n 2. 刷 WARP IPv6 (默认)"
E[37]="Checking VPS infomation..."
C[37]="检查环境中……"
E[38]="Create shortcut [warp] successfully"
C[38]="创建快捷 warp 指令成功"
E[39]="Running WARP"
C[39]="运行 WARP"
E[40]="Menu choose"
C[40]="菜单选项"
E[41]="Spend time: \$(( end - start )) seconds.\\\n The script runs today: \$TODAY. Total: \$TOTAL"
C[41]="总耗时: \$(( end - start ))秒，脚本当天运行次数: \$TODAY，累计运行次数: \$TOTAL"
E[42]="Curren architecture \$(uname -m) is not supported. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[42]="当前架构 \$(uname -m) 暂不支持,问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[43]="Run again with warp [option] [lisence], such as"
C[43]="再次运行用 warp [option] [lisence]，如"
E[44]="WARP installation failed. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[44]="WARP 安装失败，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[45]="WARP interface, Linux Client and Wireproxy have been completely deleted!"
C[45]="WARP 网络接口、 Linux Client 和 Wireproxy 已彻底删除!"
E[46]="Working mode: \$GLOBAL_OR_NOT"
C[46]="工作模式: \$GLOBAL_OR_NOT"
E[47]="Upgrade kernel, turn on BBR, change Linux system by other authors [ylx2016],[https://github.com/ylx2016/Linux-NetSpeed]"
C[47]="BBR、DD脚本用的[ylx2016]的成熟作品，地址[https://github.com/ylx2016/Linux-NetSpeed]，请熟知"
E[48]="Run script"
C[48]="安装脚本"
E[49]="Return to main menu"
C[49]="回退主目录"
E[50]="Choose:"
C[50]="请选择:"
E[51]="Please enter the correct number"
C[51]="请输入正确数字"
E[52]="Fail to establish CloudflareWARP interface. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[52]="创建 CloudflareWARP 网络接口失败，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[53]="Uninstall Socks5 Proxy Client was complete."
C[53]="Socks5 Proxy Client 卸载成功"
E[54]="\$(date +'%F %T') Region: \$REGION Done. IPv\$NF: \$WAN  \$COUNTRY  \$ASNORG. Retest after 1 hour. Brush ip runing time:\$DAY days \$HOUR hours \$MIN minutes \$SEC seconds"
C[54]="\$(date +'%F %T') 区域 \$REGION 解锁成功，IPv\$NF: \$WAN  \$COUNTRY  \$ASNORG，1 小时后重新测试，刷 IP 运行时长: \$DAY 天 \$HOUR 时 \$MIN 分 \$SEC 秒"
E[55]="\$(date +'%F %T') Try \${i}. Failed. IPv\$NF: \$WAN  \$COUNTRY  \$ASNORG. Retry after \${j} seconds. Brush ip runing time:\$DAY days \$HOUR hours \$MIN minutes \$SEC seconds"
C[55]="\$(date +'%F %T') 尝试第\${i}次，解锁失败，IPv\$NF: \$WAN  \$COUNTRY  \$ASNORG，\${j}秒后重新测试，刷 IP 运行时长: \$DAY 天 \$HOUR 时 \$MIN 分 \$SEC 秒"
E[56]="The current Netflix region is \$REGION. Confirm press [y] . If you want another regions, please enter the two-digit region abbreviation. (such as hk,sg. Default is \$REGION):"
C[56]="当前 Netflix 地区是:\$REGION，需要解锁当前地区请按 [y], 如需其他地址请输入两位地区简写 (如 hk ,sg，默认:\$REGION):"
E[57]="Install iptable + dnsmasq + ipset. Let WARP only take over the streaming media traffic (Not available for ipv6 only) (bash menu.sh e)"
C[57]="安装 iptable + dnsmasq + ipset，让 WARP IPv4 only 接管流媒体流量 (不适用于 IPv6 only VPS) (bash menu.sh e)"
E[58]="Local network interface: CloudflareWARP"
C[58]="本地网络接口: CloudflareWARP"
E[59]="WARP\$TYPE Interface is on"
C[59]="WARP\$TYPE 网络接口已开启"
E[60]="WARP Interface is on"
C[60]="WARP 网络接口已开启"
E[61]="WARP Interface is off"
C[61]="WARP 网络接口未开启"
E[62]="Uninstall WARP Interface was complete."
C[62]="WARP 网络接口卸载成功"
E[63]="Change Client or WireProxy port"
C[63]="更改 Client 或 WireProxy 端口"
E[64]="Successfully synchronized the latest version"
C[64]="成功！已同步最新脚本，版本号"
E[65]="Upgrade failed. Feedback:[https://github.com/fscarmen/warp-sh/issues]"
C[65]="升级失败，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[66]="Add WARP IPv4 interface to \${NATIVE[n]} VPS (bash menu.sh 4)"
C[66]="为 \${NATIVE[n]} 添加 WARP IPv4 网络接口 (bash menu.sh 4)"
E[67]="Add WARP IPv6 interface to \${NATIVE[n]} VPS (bash menu.sh 6)"
C[67]="为 \${NATIVE[n]} 添加 WARP IPv6 网络接口 (bash menu.sh 6)"
E[68]="Add WARP dualstack interface to \${NATIVE[n]} VPS (bash menu.sh d)"
C[68]="为 \${NATIVE[n]} 添加 WARP 双栈网络接口 (bash menu.sh d)"
E[69]="Native dualstack"
C[69]="原生双栈"
E[70]="WARP dualstack"
C[70]="WARP 双栈"
E[71]="Turn on WARP (warp o)"
C[71]="打开 WARP (warp o)"
E[72]="Turn off, uninstall WARP interface, Linux Client and WireProxy (warp u)"
C[72]="永久关闭 WARP 网络接口，并删除 WARP、 Linux Client 和 WireProxy (warp u)"
E[73]="Upgrade kernel, turn on BBR, change Linux system (warp b)"
C[73]="升级内核、安装BBR、DD脚本 (warp b)"
E[74]="Please choose the priority:\n 1. IPv4\n 2. IPv6\n 3. Use initial settings (default)"
C[74]="请选择优先级别:\n 1. IPv4\n 2. IPv6\n 3. 使用 VPS 初始设置 (默认)"
E[75]="Sync the latest version (warp v)"
C[75]="同步最新版本 (warp v)"
E[76]="Exit"
C[76]="退出脚本"
E[77]="Turn off WARP (warp o)"
C[77]="暂时关闭 WARP (warp o)"
E[78]=""
C[78]=""
E[79]="Do you uninstall the following dependencies (if any)? Please note that this will potentially prevent other programs that are using the dependency from working properly.\\\n\\\n \$UNINSTALL_DEPENDENCIES_LIST"
C[79]="是否卸载以下依赖(如有)？请注意，这将有可能使其他正在使用该依赖的程序不能正常工作\\\n\\\n \$UNINSTALL_DEPENDENCIES_LIST"
E[80]="Professional one-click script for WARP to unblock streaming media (Supports multi-platform, multi-mode and TG push)"
C[80]="WARP 解锁 Netflix 等流媒体专业一键(支持多平台、多方式和 TG 通知)"
E[81]="Step 3/3: Searching for the best MTU value is ready."
C[81]="进度 3/3: 寻找 MTU 最优值已完成"
E[82]="Install CloudFlare Client and set mode to Proxy (bash menu.sh c)"
C[82]="安装 CloudFlare Client 并设置为 Proxy 模式 (bash menu.sh c)"
E[83]="Step 1/3: Installing WARP Client..."
C[83]="进度 1/3: 安装 Client……"
E[84]="Step 2/3: Setting Client Mode"
C[84]="进度 2/3: 设置 Client 模式"
E[85]="Client was installed.\n connect/disconnect by [warp r].\n uninstall by [warp u]"
C[85]="Linux Client 已安装\n 连接/断开: warp r\n 卸载: warp u"
E[86]="Client is working. Socks5 proxy listening on: \$(ss -nltp | grep -E 'warp|wireproxy' | awk '{print \$4}')"
C[86]="Linux Client 正常运行中。 Socks5 代理监听:\$(ss -nltp | grep -E 'warp|wireproxy' | awk '{print \$4}')"
E[87]="Fail to establish Socks5 proxy. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[87]="创建 Socks5 代理失败，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[88]="Connect the client (warp r)"
C[88]="连接 Client (warp r)"
E[89]="Disconnect the client (warp r)"
C[89]="断开 Client (warp r)"
E[90]="Client is connected"
C[90]="Client 已连接"
E[91]="Client is disconnected. It could be connect again by [warp r]"
C[91]="已断开 Client，再次连接可以用 warp r"
E[92]="(!!! Already installed, do not select.)"
C[92]="(!!! 已安装，请勿选择)"
E[93]="Client is not installed."
C[93]="Client 未安装"
E[94]="Congratulations! WARP\$CLIENT_AC Linux Client is working."
C[94]="恭喜！WARP\$CLIENT_AC Linux Client 工作中"
E[95]="Global"
C[95]="全局"
E[96]="Non-global"
C[96]="非全局"
E[97]="IPv\$PRIO priority"
C[97]="IPv\$PRIO 优先"
E[98]="Uninstall Wireproxy was complete."
C[98]="Wireproxy 卸载成功"
E[99]="WireProxy is connected"
C[99]="WireProxy 已连接"
E[100]="Cannot detect any IPv4 or IPv6. The script is aborted. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[100]="检测不到任何 IPv4 或 IPv6。脚本中止，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[101]="Client support amd64 and arm64 only. Curren architecture \$ARCHITECTURE. Official Support List: [https://pkg.cloudflareclient.com/packages/cloudflare-warp]. The script is aborted. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[101]="Client 只支持 amd64 和 arm64 架构，当前架构 \$ARCHITECTURE，官方支持列表: [https://pkg.cloudflareclient.com/packages/cloudflare-warp]。脚本中止，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[102]="Client is only supported on CentOS 8 and above. Official Support List: [https://pkg.cloudflareclient.com]. The script is aborted. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[102]="Client 只支持 CentOS 8 或以上系统，官方支持列表: [https://pkg.cloudflareclient.com]。脚本中止，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[103]="Port \$PORT is in use. Please input another Port(\${i} times remaining):"
C[103]="\$PORT 端口占用中，请使用另一端口(剩余\${i}次):"
E[104]="Please customize the Client port (1000-65535. Default to 40000 if it is blank):"
C[104]="请自定义 Client 端口号 (1000-65535，如果不输入，会默认: 40000):"
E[105]="Switch \${WARP_BEFORE[m]} to \${WARP_AFTER1[m]} \${SHORTCUT1[m]}"
C[105]="\${WARP_BEFORE[m]} 转为 \${WARP_AFTER1[m]} \${SHORTCUT1[m]}"
E[106]="Switch \${WARP_BEFORE[m]} to \${WARP_AFTER2[m]} \${SHORTCUT2[m]}"
C[106]="\${WARP_BEFORE[m]} 转为 \${WARP_AFTER2[m]} \${SHORTCUT2[m]}"
E[107]="Failed registration, using a preset free account."
C[107]="注册失败，使用预设的免费账户"
E[108]="The configuration file warp.conf cannot be found. The script is aborted. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[108]="找不到配置文件 warp.conf，脚本中止，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[109]="Socks5 Proxy Client is working now. WARP IPv4 and dualstack interface could not be switch to. The script is aborted. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[109]="Socks5 代理正在运行中，不能转为 WARP IPv4 或者双栈网络接口，脚本中止，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[110]="Socks5 Proxy Client is working now. WARP IPv4 and dualstack interface could not be installed. The script is aborted. Feedback: [https://github.com/fscarmen/warp-sh/issues]"
C[110]="Socks5 代理正在运行中，WARP IPv4 或者双栈网络接口不能安装，脚本中止，问题反馈:[https://github.com/fscarmen/warp-sh/issues]"
E[111]="Cannot switch to the same form as the current one."
C[111]="不能切换为当前一样的形态"
E[112]="Not available for IPv6 only VPS"
C[112]="IPv6 only VPS 不能使用此方案"
E[113]="Install wireproxy. Wireguard client that exposes itself as a socks5 proxy or tunnels (bash menu.sh w)"
C[113]="安装 wireproxy，让 WARP 在本地创建一个 socks5 代理 (bash menu.sh w)"
E[114]="Congratulations! Wireproxy is working."
C[114]="恭喜！Wireproxy 工作中"
E[115]="WARP, WARP Linux Client, WireProxy hasn't been installed yet. The script is aborted.\n"
C[115]="WARP, WARP Linux Client, WireProxy 均未安装，脚本退出\n"
E[116]="1. WARP Linux Client account\n 2. WireProxy account"
C[116]="1. WARP Linux Client 账户\n 2. WireProxy 账户"
E[117]="1. WARP account\n 2. WireProxy account"
C[117]="1. WARP 账户\n 2. WireProxy 账户"
E[118]="1. WARP account\n 2. WARP Linux Client account"
C[118]="1. WARP 账户\n 2. WARP Linux Client 账户"
E[119]="1. WARP account\n 2. WARP Linux Client account\n 3. WireProxy account"
C[119]="1. WARP 账户\n 2. WARP Linux Client 账户\n 3. WireProxy 账户"
E[120]="WARP has not been installed yet."
C[120]="WARP 还未安装"
E[121]="(!!! Only supports amd64 and arm64, do not select.)"
C[121]="(!!! 只支持 amd64 和 arm64，请勿选择)"
E[122]="WireProxy has not been installed yet."
C[122]="WireProxy 还未安装"
E[123]="WireProxy is disconnected. It could be connect again by [warp y]"
C[123]="已断开 Wireproxy，再次连接可以用 warp y"
E[124]="WireProxy is on"
C[124]="WireProxy 已开启"
E[125]="WireProxy is not installed."
C[125]="WireProxy 未安装"
E[126]="WireProxy is installed and disconnected"
C[126]="WireProxy 已安装，状态为断开连接"
E[127]="Connect the Wireproxy (warp y)"
C[127]="连接 Wireproxy (warp y)"
E[128]="Disconnect the Wireproxy (warp y)"
C[128]="断开 Wireproxy (warp y)"
E[129]="WireProxy Solution. A wireguard client that exposes itself as a socks5 proxy or tunnels. Adapted from the mature works of [pufferffish],[https://github.com/pufferffish/wireproxy]"
C[129]="WireProxy，让 WARP 在本地建议一个 socks5 代理。改编自 [pufferffish] 的成熟作品，地址[https://github.com/pufferffish/wireproxy]，请熟知"
E[130]="WireProxy was installed.\n connect/disconnect by [warp y]\n uninstall by [warp u]"
C[130]="WireProxy 已安装\n 连接/断开: warp y\n 卸载: warp u"
E[131]="WARP iptable was installed.\n connect/disconnect by [warp o]\n uninstall by [warp u]"
C[131]="WARP iptable 已安装\n 连接/断开: warp o\n 卸载: warp u"
E[132]="Install CloudFlare Client and set mode to WARP (bash menu.sh l)"
C[132]="安装 CloudFlare Client 并设置为 WARP 模式 (bash menu.sh l)"
E[133]="Confirm all uninstallation please press [y], other keys do not uninstall by default:"
C[133]="确认全部卸载请按 [y]，其他键默认不卸载:"
E[134]="Uninstall dependencies were complete."
C[134]="依赖卸载成功"
E[135]="No suitable solution was found for modifying the warp configuration file warp.conf and the script aborted. When you see this message, please send feedback on the bug to:[https://github.com/fscarmen/warp-sh/issues]"
C[135]="没有找到适合的方案用于修改 warp 配置文件 warp.conf，脚本中止。当你看到此信息，请把该 bug 反馈至:[https://github.com/fscarmen/warp-sh/issues]"
E[136]="Can only be run using \$KERNEL_OR_WIREGUARD_GO."
C[136]="只能使用 \$KERNEL_OR_WIREGUARD_GO 运行"
E[137]="Install using:\n 1. wireguard kernel (default)\n 2. wireguard-go with reserved"
C[137]="请选择 wireguard 方式:\n 1. wireguard 内核 (默认)\n 2. wireguard-go with reserved"
E[138]="\${WIREGUARD_BEFORE} ---> \${WIREGUARD_AFTER}. Confirm press [y] :"
C[138]="\${WIREGUARD_BEFORE} ---> \${WIREGUARD_AFTER}， 确认请按 [y] :"
E[139]="Working mode:\n 1. Global (default)\n 2. Non-global"
C[139]="工作模式:\n 1. 全局 (默认)\n 2. 非全局"
E[140]="Failed to get a WARP IP with wireguard kernel. Switching to wireguard-go with reserved and retrying..."
C[140]="使用 wireguard 内核获取 WARP IP 失败，正切换到 wireguard-go with reserved 重试……"

# 自定义字体彩色，read 函数
warning() { echo -e "\033[31m\033[01m$*\033[0m"; }  # 红色
error() { echo -e "\033[31m\033[01m$*\033[0m" && exit 1; }  # 红色
info() { echo -e "\033[32m\033[01m$*\033[0m"; }   # 绿色
hint() { echo -e "\033[33m\033[01m$*\033[0m"; }   # 黄色
reading() { read -rp "$(info "$1")" "$2"; }

# 清理临时文件
cleanup_temp() {
  rm -f /tmp/{ip,wireguard-go-*,best_mtu,statistics,cdn_proxy} 2>/dev/null
}

# 中断信号处理
on_interrupt_exit() {
  cleanup_temp
  echo -e '\n'
  exit 1
}

# 预处理：扫描 E/C 数组，把含 $ 的条目下标记录到关联数组，避免 text() 每次调用都启动 grep 子进程
declare -A TEXT_NEEDS_EVAL
for _text_i in "${!E[@]}"; do
  [[ "${E[${_text_i}]}" == *'$'* || "${C[${_text_i}]}" == *'$'* ]] && TEXT_NEEDS_EVAL[${_text_i}]=1
done
unset _text_i

# text <index>：输出当前语言对应的字符串，含 $ 变量的条目用 eval 展开，其余直接 printf
text() {
  local -n _text_arr="${L}"        # nameref 指向 E 或 C，零子进程
  local _text_val="${_text_arr[$*]}"
  if [[ -n "${TEXT_NEEDS_EVAL[$*]}" ]]; then
    eval "printf '%s' \"${_text_val}\""
  else
    printf '%s' "${_text_val}"
  fi
}

# 检测是否需要启用 Github CDN，如能直接连通 api.github.com，则不使用
check_cdn() {
  local PROXY CODE PID CMD
  local _WAIT_COUNT=120
  local PIDS=()
  local API_URL='https://api.github.com/repos/fscarmen/warp-sh/releases'

  # 确定下载工具：优先 wget，次选 curl
  if command -v wget >/dev/null 2>&1; then
    CMD='wget'
  elif command -v curl >/dev/null 2>&1; then
    CMD='curl'
  else
    GH_PROXY=''
    return
  fi

  # 获取 HTTP 状态码
  get_code() {
    local url=$1
    if [ "$CMD" = 'wget' ]; then
      wget -qT5 -O /dev/null --server-response "$url" 2>&1 | awk '/HTTP\//{code=$2} END{print code}'
    else
      curl -skL -w "%{http_code}" "$url" -o /dev/null
    fi
  }

  # 直连检测
CODE=200
  #####CODE=$(get_code "$API_URL")
  if [ "$CODE" = '200' ]; then
    GH_PROXY=''
    return
  fi

  # 并发探测代理
  for PROXY in "${GITHUB_PROXY[@]}"; do
    {
      CODE=$(get_code "${PROXY}${API_URL}")
      [ "$CODE" = '200' ] && [ ! -e "/tmp/cdn_proxy" ] && printf '%s' "$PROXY" > "/tmp/cdn_proxy"
    } &
    PIDS+=("$!")
  done

  # 等第一个返回 200 的代理，超时则回退为直连，避免无限等待卡死
  while [ ! -e "/tmp/cdn_proxy" ] && [ "$_WAIT_COUNT" -gt 0 ]; do
    sleep 0.05
    (( _WAIT_COUNT-- )) || true
  done

  [ -e "/tmp/cdn_proxy" ] && GH_PROXY=$(cat "/tmp/cdn_proxy") || GH_PROXY=''

  # 清理后台任务和临时文件
  for PID in "${PIDS[@]}"; do kill "$PID" >/dev/null 2>&1 || true; done
  for PID in "${PIDS[@]}"; do wait "$PID" 2>/dev/null || true; done
  rm -f "/tmp/cdn_proxy"
}

# 脚本当天及累计运行次数统计
statistics_of_run-times() {
  local UPDATE_OR_GET=$1
  local SCRIPT=$2
  if grep -q 'update' <<< "$UPDATE_OR_GET"; then
    { wget --no-check-certificate -qO- --timeout=3 "https://stat.cloudflare.now.cc/updateStats?script=${SCRIPT}" > /tmp/statistics; }&
  elif grep -q 'get' <<< "$UPDATE_OR_GET"; then
    [ -s /tmp/statistics ] && [[ $(cat /tmp/statistics) =~ \"todayCount\":([0-9]+),\"totalCount\":([0-9]+) ]] && local TODAY="${BASH_REMATCH[1]}" && local TOTAL="${BASH_REMATCH[2]}" && rm -f /tmp/statistics
    info " $(text 41) "
  fi
}

# 选择语言，先判断 /etc/wireguard/language 里的语言选择，没有的话再让用户选择，默认英语。处理中文显示的问题
select_language() {
  UTF8_LOCALE=$(locale -a 2>/dev/null | grep -iEm1 "UTF-8|utf8")
  [ -n "$UTF8_LOCALE" ] && export LC_ALL="$UTF8_LOCALE" LANG="$UTF8_LOCALE" LANGUAGE="$UTF8_LOCALE"

  if [ -s /etc/wireguard/language ]; then
    L=$(cat /etc/wireguard/language)
  else
    L=E && [[ -z "$OPTION" || "$OPTION" = [aclehdpbviw46sg] ]] && hint " $(text 0) \n" && reading " $(text 50) " LANGUAGE
    [ "$LANGUAGE" = 2 ] && L=C
  fi
}

# 必须以root运行脚本
check_root() {
  [ "$(id -u)" != 0 ] && error " $(text 2) "
}

# 判断虚拟化
check_virt() {
  if [ "$1" = 'Alpine' ]; then
    VIRT=$(virt-what | tr '\n' ' ')
  else
    [ "$(type -p systemd-detect-virt)" ] && VIRT=$(systemd-detect-virt)
    [[ -z "$VIRT" && -x "$(type -p hostnamectl)" ]] && VIRT=$(hostnamectl | awk '/Virtualization:/{print $NF}')
  fi
}

# 多方式判断操作系统，试到有值为止。只支持 Debian 10/11、Ubuntu 18.04/20.04 或 CentOS 7/8 ,如非上述操作系统，退出脚本
check_operating_system() {
  if [ -s /etc/os-release ]; then
    SYS="$(awk -F= '/^PRETTY_NAME=/{gsub(/"/,"",$2);print $2;exit}' /etc/os-release)"
  elif [ -x "$(type -p hostnamectl)" ]; then
    SYS="$(awk -F: '/System/{sub(/^[ \t]+/,"",$2);print $2;exit}' < <(hostnamectl))"
  elif [ -x "$(type -p lsb_release)" ]; then
    SYS="$(lsb_release -sd)"
  elif [ -s /etc/lsb-release ]; then
    SYS="$(awk -F= '/^DISTRIB_DESCRIPTION=/{gsub(/"/,"",$2);print $2;exit}' /etc/lsb-release)"
  elif [ -s /etc/redhat-release ]; then
    SYS="$(awk '{print;exit}' /etc/redhat-release)"
  elif [ -s /etc/issue ]; then
    SYS="$(awk '{print;exit}' /etc/issue)"
  fi

  # 自定义 Alpine 系统若干函数
  alpine_warp_restart() {
    wg-quick down warp >/dev/null 2>&1
    wg-quick up warp >/dev/null 2>&1
  }

  alpine_warp_enable() {
    echo -e "/usr/bin/tun.sh\nwg-quick up warp" > /etc/local.d/warp.start
    chmod +x /etc/local.d/warp.start
    rc-update add local
    wg-quick up warp >/dev/null 2>&1
  }

  REGEX=("debian" "ubuntu" "centos|red hat|kernel|alma|rocky" "alpine" "arch linux|endeavouros" "fedora")
  RELEASE=("Debian" "Ubuntu" "CentOS" "Alpine" "Arch" "Fedora")
  PACKAGE_UPDATE=("apt -y update" "apt -y update" "yum -y update --skip-broken" "apk update -f" "pacman -Sy" "dnf -y update")
  PACKAGE_INSTALL=("apt -y install" "apt -y install" "yum -y install" "apk add -f" "pacman -S --noconfirm" "dnf -y install")
  PACKAGE_UNINSTALL=("apt -y autoremove" "apt -y autoremove" "yum -y autoremove" "apk del -f" "pacman -Rcnsu --noconfirm" "dnf -y autoremove")
  SYSTEMCTL_START=("systemctl start wg-quick@warp" "systemctl start wg-quick@warp" "systemctl start wg-quick@warp" "wg-quick up warp" "systemctl start wg-quick@warp" "systemctl start wg-quick@warp")
  SYSTEMCTL_RESTART=("systemctl restart wg-quick@warp" "systemctl restart wg-quick@warp" "systemctl restart wg-quick@warp" "alpine_warp_restart" "systemctl restart wg-quick@warp" "systemctl restart wg-quick@warp")
  SYSTEMCTL_ENABLE=("systemctl enable --now wg-quick@warp" "systemctl enable --now wg-quick@warp" "systemctl enable --now wg-quick@warp" "alpine_warp_enable" "systemctl enable --now wg-quick@warp" "systemctl enable --now wg-quick@warp")

  for int in "${!REGEX[@]}"; do
    [[ "${SYS,,}" =~ ${REGEX[int]} ]] && SYSTEM="${RELEASE[int]}" && break
  done

  # 针对各厂运的订制系统
  if [ -z "$SYSTEM" ]; then
    [ -x "$(type -p yum)" ] && int=2 && SYSTEM='CentOS' || error " $(text 5) "
  fi

  # 判断主 Linux 版本
  MAJOR_VERSION=$(awk '{gsub(/[^0-9.]/,"");print int($0)}' <<< "$SYS")
}

# 安装系统依赖及定义 ping 指令
check_dependencies() {
  # 对于 alpine 系统，升级库并重新安装依赖
  if [ "$SYSTEM" = 'Alpine' ]; then
    CHECK_WGET=$(wget 2>&1 | head -n 1)
    grep -qi 'busybox' <<< "$CHECK_WGET" && ${PACKAGE_INSTALL[int]} wget >/dev/null 2>&1
    DEPS_CHECK=("ping" "curl" "grep" "bash" "ip" "virt-what")
    DEPS_INSTALL=("iputils-ping" "curl" "grep" "bash" "iproute2" "virt-what")
  else
    # 对于三大系统需要的依赖
    DEPS_CHECK=("ping" "wget" "curl" "systemctl" "ip")
    DEPS_INSTALL=("iputils-ping" "wget" "curl" "systemctl" "iproute2")
  fi

  for g in "${!DEPS_CHECK[@]}"; do
    [ ! -x "$(type -p ${DEPS_CHECK[g]})" ] && [[ ! "${DEPS[@]}" =~ "${DEPS_INSTALL[g]}" ]] && DEPS+=(${DEPS_INSTALL[g]})
  done

  if [ "${#DEPS[@]}" -ge 1 ]; then
    info "\n $(text 7) ${DEPS[@]} \n"
    ${PACKAGE_UPDATE[int]} >/dev/null 2>&1
    ${PACKAGE_INSTALL[int]} ${DEPS[@]} >/dev/null 2>&1
  else
    info "\n $(text 8) \n"
  fi

  PING6='ping -6' && [ -x "$(type -p ping6)" ] && PING6='ping6'
}

# 获取 warp 账户信息
warp_api(){
  local RUN=$1
  local FILE_PATH=$2

  if [ -s "$FILE_PATH" ]; then
    # 官方 api 文件，默认存放路径为 /etc/wireguard/warp-account.conf
    if grep -q 'client_id' $FILE_PATH; then
      local WARP_DEVICE_ID=$(awk -F '"' '/"id"/ {print $4; exit}' "$FILE_PATH")
      local WARP_TOKEN=$(awk -F '"' '/"token"/ {print $4; exit}' "$FILE_PATH")
      local WARP_CLIENT_ID=$(awk -F '"' '/client_id/ {print $4; exit}' "$FILE_PATH")

    # client 文件，默认存放路径为 /var/lib/cloudflare-warp/reg.json
    elif grep -q 'registration_id' $FILE_PATH; then
      local WARP_DEVICE_ID=$(sed 's/.*registration_id":"\([^"]\+\)".*/\1/' "$FILE_PATH")
      local WARP_TOKEN=$(sed 's/.*api_token":"\([^"]\+\)".*/\1/' "$FILE_PATH")
    fi
  fi

  case "$RUN" in
    register )
      local ACCOUNT=$(curl --retry 50 --retry-delay 1 --max-time 2 --silent --location --fail "https://warp.cloudflare.nyc.mn/?run=register")
      grep -q '"id"' <<< "$ACCOUNT" && echo "$ACCOUNT" ||
      echo '{
  "id": "b0fe9b24-3396-486e-a12d-c194dbbb7bfb",
  "type": "a",
  "model": "PC",
  "name": "",
  "key": "rizJSrjeCO51ck8Rmj9YwstFnf6M9rJKZIXFQo3y8j8=",
  "private_key": "hTk06uwwXhZx3RVqtug3MQ0RSodzdM/U5z/M5NIbh4c=",
  "account": {
    "id": "5a43e4b3-2e13-46b9-9437-2abe55cd5f4b",
    "account_type": "free",
    "created": "2025-12-02T16:44:10.752518443Z",
    "updated": "2025-12-02T16:44:10.752518443Z",
    "premium_data": 0,
    "quota": 0,
    "usage": 0,
    "warp_plus": true,
    "referral_count": 0,
    "referral_renewal_countdown": 0,
    "role": "child",
    "license": "36L7Pg9E-j6Jp2x04-I40UQ39C",
    "ttl": "2026-03-02T16:44:10.752514723Z"
  },
  "config": {
    "client_id": "lzaY",
    "reserved": [
      151,
      54,
      152
    ],
    "peers": [
      {
        "public_key": "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=",
        "endpoint": {
          "v4": "162.159.192.5:0",
          "v6": "[2606:4700:d0::a29f:c005]:0",
          "host": "engage.cloudflareclient.com:2408",
          "ports": [
            2408,
            500,
            1701,
            4500
          ]
        }
      }
    ],
    "interface": {
      "addresses": {
        "v4": "172.16.0.2",
        "v6": "2606:4700:110:8921:bf06:c4d7:40b7:8afd"
      }
    },
    "services": {
      "http_proxy": "172.16.0.1:2480"
    }
  },
  "token": "50d988c2-b5fb-c829-42dd-a33a960ea734",
  "warp_enabled": false,
  "waitlist_enabled": false,
  "created": "2025-12-02T16:44:10.327083841Z",
  "updated": "2025-12-02T16:44:10.327083841Z",
  "tos": "2025-12-02T16:44:10.272Z",
  "place": 0,
  "locale": "zh-CN",
  "enabled": true,
  "install_id": "095iylvdl1trz7ukonr00g",
  "fcm_token": "095iylvdl1trz7ukonr00g:APA91ba32nwi5zphdi3ercafxodyjr6iwlrrgb919l2gcm4h5irun8y8nsuhbdmc0kufcxhopvonqql4gllld8nsjaavi17hf7yfl5qhdpz03oq4u69ngu0s5hyo6wxiy4luk8xeenf1",
  "serial_number": "095iylvdl1trz7ukonr00g",
  "policy": {
    "always_include": [
      {
        "ip": "162.159.197.4"
      },
      {
        "ip": "2606:4700:102::4"
      }
    ],
    "always_exclude": [
      {
        "ip": "162.159.197.3"
      },
      {
        "ip": "2606:4700:102::3"
      }
    ],
    "post_quantum": "enabled_with_downgrades",
    "tunnel_protocol": "masque"
  }
}'
      ;;
    cancel )
      # 只保留 Teams 或者预设账户，删除其他账户
      if ! grep -oqE '"id":[ ]+("(t.[A-F0-9a-f]{8}-[A-F0-9a-f]{4}-[A-F0-9a-f]{4}-[A-F0-9a-f]{4}-[A-F0-9a-f]{12})|b0fe9b24-3396-486e-a12d-c194dbbb7bfb")' $FILE_PATH; then
        curl --request DELETE "https://api.cloudflareclient.com/v0a2158/reg/${WARP_DEVICE_ID}" \
            --head \
            --silent \
            --location \
            --header 'User-Agent: okhttp/3.12.1' \
            --header 'CF-Client-Version: a-6.10-2158' \
            --header 'Content-Type: application/json' \
            --header "Authorization: Bearer ${WARP_TOKEN}" | awk '/HTTP/{print $(NF-1)}'
      fi
      ;;
  esac
}

# 聚合 IP api 函数。由于 ip.sb 会对某些 ip 访问报 error code: 1015，所以使用备用 IP api: ifconfig.co
ip_info() {
  local CHECK_46="$1"
  if [[ "$2" =~ ^[0-9]+$ ]]; then
    local INTERFACE_SOCK5="--proxy socks5h://127.0.0.1:$2"
  elif [[ "$2" =~ ^[[:alnum:]]+$ ]]; then
    local INTERFACE_SOCK5="--interface $2"
  fi

  [ "$L" = 'C' ] && local IS_CHINESE=${IS_CHINESE:-'?lang=zh-CN'}

  # 对于查 socks5 代理的 IP，需要用另一个 IP api
  if grep -q 'socks5'  <<< "$INTERFACE_SOCK5"; then
    local WAN=$(curl -s -A a --retry 2 $INTERFACE_SOCK5 https://api-ipv${CHECK_46}.ip.sb/ip) &&
    local IP_JSON=$(curl -sm2 --retry 2 http://ip.cloudflare.nyc.mn/${WAN}${IS_CHINESE}) &&
    grep -qi '"isp".*Cloudflare' <<< "$IP_JSON" && local IP_TRACE='on'
  else
    local IP_JSON=$(curl --retry 2 -ksm2 $INTERFACE_SOCK5 -$CHECK_46 http://ip.cloudflare.nyc.mn${IS_CHINESE}) &&
    local IP_TRACE=$(awk -F '"' '/"warp"/{print $4}' <<< "$IP_JSON") &&
    local WAN=$(awk -F '"' '/"ip"/{print $4}' <<< "$IP_JSON")
  fi

  if grep -q '"ip"' <<< "$IP_JSON"; then
    local COUNTRY=$(awk -F '"' '/"country"/{print $4}' <<< "$IP_JSON")
    local ASNORG=$(awk -F '"' '/"isp"/{print $4}' <<< "$IP_JSON")
  fi

  echo "{ \"trace\": \"$IP_TRACE\", \"ip\": \"$WAN\", \"country\": \"$COUNTRY\", \"asnorg\": \"$ASNORG\" }"
}

# 根据场景传参调用自定义 IP api
ip_case() {
  local CHECK_46="$1"
  [ -n "$2" ] && local CHECK_TYPE="$2"
  [ "$3" = 'non-global' ] && local CHECK_NONGLOBAL='warp'

  if [ "$CHECK_TYPE" = "warp" ]; then
    fetch_4() {
      unset IP_RESULT4 COUNTRY4 ASNORG4 TRACE4
      local IP_RESULT4=$(ip_info 4 "$CHECK_NONGLOBAL")
      TRACE4=$(sed -n 's/.*"trace":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      WAN4=$(sed -n 's/.*"ip":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      COUNTRY4=$(sed -n 's/.*"country":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      ASNORG4=$(sed -n 's/.*"asnorg":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
    }

    fetch_6() {
      unset IP_RESULT6 COUNTRY6 ASNORG6 TRACE6
      local IP_RESULT6=$(ip_info 6 "$CHECK_NONGLOBAL")
      TRACE6=$(sed -n 's/.*"trace":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      WAN6=$(sed -n 's/.*"ip":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      COUNTRY6=$(sed -n 's/.*"country":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      ASNORG6=$(sed -n 's/.*"asnorg":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
    }

    case "$CHECK_46" in
      4|6 )
        fetch_${CHECK_46}
        ;;
      d|u )
        # 如在非全局模式，根据 AllowedIPs 的 v4、v6 情况再查 ip 信息；如在全局模式下则全部查
        if [ -e /etc/wireguard/warp.conf ] && grep -q '^Table' /etc/wireguard/warp.conf; then
          grep -q "^#.*0\.\0\/0" 2>/dev/null /etc/wireguard/warp.conf || fetch_4
          grep -q "^#.*\:\:\/0" 2>/dev/null /etc/wireguard/warp.conf || fetch_6
        else
          fetch_4
          fetch_6
        fi
        ;;
    esac
  elif [ "$CHECK_TYPE" = "wireproxy" ]; then
    fetch_4() {
      unset IP_RESULT4 WIREPROXY_TRACE4 WIREPROXY_WAN4 WIREPROXY_COUNTRY4 WIREPROXY_ASNORG4 ACCOUNT AC
      local IP_RESULT4=$(ip_info 4 "$WIREPROXY_PORT")
      WIREPROXY_TRACE4=$(sed -n 's/.*"trace":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      WIREPROXY_WAN4=$(sed -n 's/.*"ip":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      WIREPROXY_COUNTRY4=$(sed -n 's/.*"country":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      WIREPROXY_ASNORG4=$(sed -n 's/.*"asnorg":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
    }

    fetch_6() {
      unset IP_RESULT6 WIREPROXY_TRACE6 WIREPROXY_WAN6 WIREPROXY_COUNTRY6 WIREPROXY_ASNORG6 ACCOUNT AC
      local IP_RESULT6=$(ip_info 6 "$WIREPROXY_PORT")
      WIREPROXY_TRACE6=$(sed -n 's/.*"trace":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      WIREPROXY_WAN6=$(sed -n 's/.*"ip":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      WIREPROXY_COUNTRY6=$(sed -n 's/.*"country":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      WIREPROXY_ASNORG6=$(sed -n 's/.*"asnorg":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
    }

    unset WIREPROXY_SOCKS5 WIREPROXY_PORT
    WIREPROXY_SOCKS5=$(ss -nltp | awk '/"wireproxy"/{print $4}')
    WIREPROXY_PORT=$(cut -d: -f2 <<< "$WIREPROXY_SOCKS5")

    case "$CHECK_46" in
      4|6 )
        fetch_$CHECK_46
        [ "$(eval echo "\$WIREPROXY_TRACE$CHECK_46")" = plus ] && WIREPROXY_ACCOUNT='+' || WIREPROXY_ACCOUNT=' Free'
        ;;
      d )
        fetch_4
        fetch_6
        [[ "$WIREPROXY_TRACE4$WIREPROXY_TRACE6" =~ 'plus' ]] && WIREPROXY_ACCOUNT='+' || WIREPROXY_ACCOUNT=' Free'
    esac
  elif [ "$CHECK_TYPE" = "client" ]; then
    fetch_4(){
      unset IP_RESULT4 CLIENT_TRACE4 CLIENT_WAN4 CLIENT_COUNTRY4 CLIENT_ASNORG4 CLIENT_ACCOUNT CLIENT_AC
      local IP_RESULT4=$(ip_info 4 "$CLIENT_PORT")
      CLIENT_TRACE4=$(sed -n 's/.*"trace":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      CLIENT_WAN4=$(sed -n 's/.*"ip":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      CLIENT_COUNTRY4=$(sed -n 's/.*"country":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      CLIENT_ASNORG4=$(sed -n 's/.*"asnorg":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
    }

    fetch_6(){
      unset IP_RESULT6 CLIENT_TRACE6 CLIENT_WAN6 CLIENT_COUNTRY6 CLIENT_ASNORG6 CLIENT_ACCOUNT CLIENT_AC
      local IP_RESULT6=$(ip_info 6 "$CLIENT_PORT")
      CLIENT_TRACE6=$(sed -n 's/.*"trace":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      CLIENT_WAN6=$(sed -n 's/.*"ip":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      CLIENT_COUNTRY6=$(sed -n 's/.*"country":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      CLIENT_ASNORG6=$(sed -n 's/.*"asnorg":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
    }

    unset CLIENT_SOCKS5 CLIENT_PORT
    CLIENT_SOCKS5=$(ss -nltp | awk '/"warp-svc"/{print $4}')
    CLIENT_PORT=$(cut -d: -f2 <<< "$CLIENT_SOCKS5")

    if [ "$CHECK_46" = 'd' ]; then
      fetch_4
      fetch_6
    else
      fetch_$CHECK_46
    fi

    local CLIENT_ACCOUNT=$(warp-cli --accept-tos registration show 2>/dev/null | awk  '/type/{print $3}')
    [ "$CLIENT_ACCOUNT" = Limited ] && CLIENT_AC='+' || CLIENT_AC=' Free'

  elif [ "$CHECK_TYPE" = "is_luban" ]; then
    fetch_4(){
      unset IP_RESULT4 CFWARP_COUNTRY4 CFWARP_ASNORG4 CFWARP_TRACE4 CFWARP_WAN4 CLIENT_ACCOUNT CLIENT_AC
      local IP_RESULT4=$(ip_info 4 CloudflareWARP)
      CFWARP_TRACE4=$(sed -n 's/.*"trace":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      CFWARP_WAN4=$(sed -n 's/.*"ip":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      CFWARP_COUNTRY4=$(sed -n 's/.*"country":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
      CFWARP_ASNORG4=$(sed -n 's/.*"asnorg":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT4")
    }

    fetch_6(){
      unset IP_RESULT6 CFWARP_COUNTRY6 CFWARP_ASNORG6 CFWARP_TRACE6 CFWARP_WAN6 CLIENT_ACCOUNT CLIENT_AC
      local IP_RESULT6=$(ip_info 6 CloudflareWARP)
      CFWARP_TRACE6=$(sed -n 's/.*"trace":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      CFWARP_WAN6=$(sed -n 's/.*"ip":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      CFWARP_COUNTRY6=$(sed -n 's/.*"country":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
      CFWARP_ASNORG6=$(sed -n 's/.*"asnorg":[ ]*"\([^"]*\)".*/\1/p' <<< "$IP_RESULT6")
    }

    if [ "$CHECK_46" = 'd' ]; then
      fetch_4
      fetch_6
    else
      fetch_$CHECK_46
    fi

    local CLIENT_ACCOUNT=$(warp-cli --accept-tos registration show 2>/dev/null | awk  '/type/{print $3}')
    [ "$CLIENT_ACCOUNT" = Limited ] && CLIENT_AC='+' || CLIENT_AC=' Free'
  fi
}

# 帮助说明
help() { hint " $(text 6) "; }

# IPv4 / IPv6 优先设置
stack_priority() {
  [ "$OPTION" = s ] && case "$PRIORITY_SWITCH" in
    4 )
      PRIORITY=1
      ;;
    6 )
      PRIORITY=2
      ;;
    d )
      :
      ;;
    * )
      hint "\n $(text 74) \n" && reading " $(text 50) " PRIORITY
  esac

  [ -e /etc/gai.conf ] && sed -i '/^precedence \:\:ffff\:0\:0/d;/^label 2002\:\:\/16/d' /etc/gai.conf
  case "$PRIORITY" in
    1 )
      echo "precedence ::ffff:0:0/96  100" >> /etc/gai.conf
      ;;
    2 )
      echo "label 2002::/16   2" >> /etc/gai.conf
      ;;
  esac
}

# IPv4 / IPv6 优先结果
result_priority() {
  PRIO=(0 0)
  if [ -e /etc/gai.conf ]; then
    grep -qsE "^precedence[ ]+::ffff:0:0/96[ ]+100" /etc/gai.conf && PRIO[0]=1
    grep -qsE "^label[ ]+2002::/16[ ]+2" /etc/gai.conf && PRIO[1]=1
  fi
  case "${PRIO[*]}" in
    '1 0' )
      PRIO=4
      ;;
    '0 1' )
      PRIO=6
      ;;
    * )
      [[ "$(curl -ksm8 --user-agent Mozilla https://www.cloudflare.com/cdn-cgi/trace | awk -F '=' '/^ip/{print $NF}')" =~ ^([0-9]{1,3}\.){3} ]] && PRIO=4 || PRIO=6
  esac
  PRIORITY_NOW=$(text 97)

  # 如是快捷方式切换优先级别的话，显示结果
  [ "$OPTION" = s ] && hint "\n $PRIORITY_NOW \n"
}

# 更换 Netflix IP 时确认期望区域
input_region() {
  if [ -n "$NF" ]; then
    REGION=$(curl --user-agent "${UA_Browser}" -$NF $GLOBAL -fs --max-time 10 http://www.cloudflare.com/cdn-cgi/trace | awk -F '=' '/^loc/{print $NF}')
  elif [ -n "$WIREPROXY_PORT" ]; then
    REGION=$(curl --user-agent "${UA_Browser}" --proxy socks5h://127.0.0.1:$WIREPROXY_PORT -fs --max-time 10 http://www.cloudflare.com/cdn-cgi/trace | awk -F '=' '/^loc/{print $NF}')
  elif [ -n "$INTERFACE" ]; then
    REGION=$(curl --user-agent "${UA_Browser}" $INTERFACE -fs --max-time 10 http://www.cloudflare.com/cdn-cgi/trace | awk -F '=' '/^loc/{print $NF}')
  else
    REGION='US'
  fi
  reading " $(text 56) " EXPECT
  until [[ -z "$EXPECT" || "${EXPECT,,}" = 'y' || "${EXPECT,,}" =~ ^[a-z]{2}$ ]]; do
    reading " $(text 56) " EXPECT
  done
  [[ -z "$EXPECT" || "${EXPECT,,}" = 'y' ]] && EXPECT="${REGION^^}"
}

# 更换支持 Netflix WARP IP 改编自 [luoxue-bot] 的成熟作品，地址[https://github.com/luoxue-bot/warp_auto_change_ip]
change_ip() {
  check_unlock() {
    ARGS=$1;

    {
      curl $ARGS --user-agent "${UA_Browser}" --include -SsL --max-time 10 --tlsv1.3 "$URL_ORIGINAL";
      curl $ARGS --user-agent "${UA_Browser}" --include -SsL --max-time 10 --tlsv1.3 "$URL_REGIONAL";
    } 2>&1 | awk '
      # NR==1 表示处理第一行数据，设置 u 为 1 表示开始处理第一个 URL 的结果
      NR==1 { u=1 }

      # 如果检测到 HTTP/2 200 且 c 尚未设置，说明第一个测试页面连接成功
      /HTTP\/2 200/ && u && !c { c=1 }

      # 如果页面源码中包含 og:video 标签，说明可以播放该视频 (v=1 代表全解锁)
      /og:video/ { v=1 }

      # 匹配页面源码中的 "requestCountry" 字段，提取区域 ID (如 HK, US, TW)
      {
        if (u && !r && match($0, /"requestCountry":\{"supportedLocales":\[[^]]+\],"id":"[^"]+"/)) {
          s = substr($0, RSTART, RLENGTH);
          sub(/.*"id":"*/, "", s);
          sub(/".*/, "", s);
          r = s
        }
      }

      # 打印最终的 JSON 结果
      END {
        print "{";
        print "  \"connect\": " (c ? "true" : "false") ",";
        if (c) {
          print "  \"Netflix\": \"" (v ? "Yes" : "Originals Only") "\",";
          print "  \"region\": \"" r "\""
        };
        print "}"
      }
    '
  }

  change_stack() {
    hint "\n $(text 36) \n" && reading " $(text 50) " NETFLIX
   [ "$NETFLIX" = 1 ] && { NF='4'; SOCKS5_NF='-4'; } || { NF='6'; SOCKS5_NF=''; }
  }

  change_warp() {
    warp_restart() {
      warning " $(text 55) "
      wg | grep -q '^interface:' && wg-quick down warp >/dev/null 2>&1
      warp_api "cancel" "/etc/wireguard/warp-account.conf" >/dev/null 2>&1
      warp_api "register" > /etc/wireguard/warp-account.conf 2>/dev/null
      local PRIVATEKEY="$(grep 'private_key' /etc/wireguard/warp-account.conf | cut -d\" -f4)"
      local ADDRESS6="$(grep '"v6.*"$' /etc/wireguard/warp-account.conf | cut -d\" -f4)"
      local CLIENT_ID="$(awk '/"reserved": \[/{flag=1; printf "["; next} flag && /\]/{printf "]"; flag=0; print ""; next} flag {gsub(/[ \t\n\r]/,""); printf "%s", $0}' /etc/wireguard/warp-account.conf)"
      [ -s /etc/wireguard/warp.conf ] && sed -i "s#\(PrivateKey[ ]\+=[ ]\+\).*#\1$PRIVATEKEY#g; s#\(Address[ ]\+=[ ]\+\).*\(/128$\)#\1$ADDRESS6\2#g; s#\(.*Reserved[ ]\+=[ ]\+\).*#\1$CLIENT_ID#g" /etc/wireguard/warp.conf
      ss -nltp | grep dnsmasq >/dev/null 2>&1 && systemctl restart dnsmasq >/dev/null 2>&1
      wg-quick up warp >/dev/null 2>&1
      sleep $j
    }

    unset T4 T6
    grep -q "^#.*0\.\0\/0" 2>/dev/null /etc/wireguard/warp.conf && T4=0 || T4=1
    grep -q "^#.*\:\:\/0" 2>/dev/null /etc/wireguard/warp.conf && T6=0 || T6=1
    case "$T4$T6" in
      01 )
        NF='6'
        ;;
      10 )
        NF='4'
        ;;
      11 )
        change_stack
    esac

    # 检测[全局]或[非全局]
    grep -q '^Table' /etc/wireguard/warp.conf && GLOBAL='--interface warp'

    [ -z "$EXPECT" ] && input_region
    i=0; j=10
    while true; do
      (( i++ )) || true
      ip_now=$(date +%s); RUNTIME=$((ip_now - ip_start)); DAY=$(( RUNTIME / 86400 )); HOUR=$(( (RUNTIME % 86400 ) / 3600 )); MIN=$(( (RUNTIME % 86400 % 3600) / 60 )); SEC=$(( RUNTIME % 86400 % 3600 % 60 ))
      [ "$GLOBAL" = '--interface warp' ] && ip_case "$NF" warp non-global || ip_case "$NF" warp
      WAN=$(eval echo \$WAN$NF) && COUNTRY=$(eval echo \$COUNTRY$NF) && ASNORG=$(eval echo \$ASNORG$NF)
      unset RESULT REGION
      local RESULT=$(check_unlock "-$NF $GLOBAL")
      local REGION=$(awk -F '"' '/region/{print $4}' <<< "${RESULT}")
      REGION=${REGION:-'US'}

      grep -q '"Yes"' <<< "${RESULT}" && grep -qi "$EXPECT" <<< "$REGION" && info " $(text 54) " && i=0 && sleep 1h || warp_restart
    done
  }

  change_client() {
    client_restart() {
      local CLIENT_MODE=$(warp-cli --accept-tos settings | awk '/Mode:/{for (i=0; i<NF; i++) if ($i=="Mode:") {print $(i+1)}}')
      case "$CLIENT_MODE" in
        Warp )
          warning " $(text 55) " && warp-cli --accept-tos registration delete >/dev/null 2>&1
          rule_del >/dev/null 2>&1
          warp-cli --accept-tos registration new >/dev/null 2>&1
          sleep $j
          rule_add >/dev/null 2>&1
          ;;
        WarpProxy )
          warning " $(text 55) "
          warp-cli --accept-tos registration delete >/dev/null 2>&1
          warp-cli --accept-tos registration new >/dev/null 2>&1
          sleep $j
      esac
    }

    change_stack

    if [ "$(warp-cli --accept-tos settings | awk '/Mode:/{for (i=0; i<NF; i++) if ($i=="Mode:") {print $(i+1)}}')" = 'WarpProxy' ]; then
      [ -z "$EXPECT" ] && input_region
      i=0; j=10
      while true; do
        (( i++ )) || true
        ip_now=$(date +%s); RUNTIME=$((ip_now - ip_start)); DAY=$(( RUNTIME / 86400 )); HOUR=$(( (RUNTIME % 86400 ) / 3600 )); MIN=$(( (RUNTIME % 86400 % 3600) / 60 )); SEC=$(( RUNTIME %86400 % 3600 % 60 ))
        ip_case "$NF" client
        WAN=$(eval echo "\$CLIENT_WAN$NF") && ASNORG=$(eval echo "\$CLIENT_ASNORG$NF") && COUNTRY=$(eval echo "\$CLIENT_COUNTRY$NF")
        unset RESULT REGION
        local RESULT=$(check_unlock "$SOCKS5_NF -sx socks5h://127.0.0.1:$CLIENT_PORT")
        local REGION=$(awk -F '"' '/region/{print $4}' <<< "${RESULT}")
        REGION=${REGION:-'US'}

        grep -q '"Yes"' <<< "${RESULT}" && grep -qi "$EXPECT" <<< "$REGION" && info " $(text 54) " && i=0 && sleep 1h || client_restart
      done

    else
      [ -z "$EXPECT" ] && input_region
      i=0; j=10
      while true; do
        (( i++ )) || true
        ip_now=$(date +%s); RUNTIME=$((ip_now - ip_start)); DAY=$(( RUNTIME / 86400 )); HOUR=$(( (RUNTIME % 86400 ) / 3600 )); MIN=$(( (RUNTIME % 86400 % 3600) / 60 )); SEC=$(( RUNTIME % 86400 % 3600 % 60 ))
        ip_case "$NF" is_luban
        WAN=$(eval echo "\$CFWARP_WAN$NF") && COUNTRY=$(eval echo "\$CFWARP_COUNTRY$NF") && ASNORG=$(eval echo "\$CFWARP_ASNORG$NF")
        unset RESULT REGION
        local RESULT=$(check_unlock "$INTERFACE -sx socks5h://127.0.0.1:$CLIENT_PORT")
        local REGION=$(awk -F '"' '/region/{print $4}' <<< "${RESULT}")
        REGION=${REGION:-'US'}

        grep -q '"Yes"' <<< "${RESULT}" && grep -qi "$EXPECT" <<< "$REGION" && info " $(text 54) " && i=0 && sleep 1h || client_restart
      done
    fi
  }

  change_wireproxy() {
    wireproxy_restart() { warning " $(text 55) " && systemctl restart wireproxy; sleep $j; }

    change_stack

    [ -z "$EXPECT" ] && input_region
    i=0; j=3
    while true; do
      (( i++ )) || true
      ip_now=$(date +%s); RUNTIME=$((ip_now - ip_start)); DAY=$(( RUNTIME / 86400 )); HOUR=$(( (RUNTIME % 86400 ) / 3600 )); MIN=$(( (RUNTIME % 86400 % 3600) / 60 )); SEC=$(( RUNTIME % 86400 % 3600 % 60 ))
      ip_case "$NF" wireproxy
      WAN=$(eval echo "\$WIREPROXY_WAN$NF") && ASNORG=$(eval echo "\$WIREPROXY_ASNORG$NF") && COUNTRY=$(eval echo "\$WIREPROXY_COUNTRY$NF")
      unset RESULT REGION
      local RESULT=$(check_unlock "$SOCKS5_NF -sx socks5h://127.0.0.1:$WIREPROXY_PORT")
      local REGION=$(awk -F '"' '/region/{print $4}' <<< "${RESULT}")
      REGION=${REGION:-'US'}

      grep -q '"Yes"' <<< "${RESULT}" && grep -qi "$EXPECT" <<< "$REGION" && info " $(text 54) " && i=0 && sleep 1h || wireproxy_restart
    done
  }

  # 设置时区，让时间戳时间准确，显示脚本运行时长，中文为 GMT+8，英文为 UTC; 设置 UA
  ip_start=$(date +%s)
  [ "$SYSTEM" != Alpine ] && ( [ "$L" = C ] && timedatectl set-timezone Asia/Shanghai || timedatectl set-timezone UTC )

  # 定义测试的两个 URL
  # 81280792 通常是全球自制剧 (Netflix Original)
  # 70143836 通常是非全球授权剧 (如 Breaking Bad)，用于检测是否全解锁
  local URL_ORIGINAL="https://www.netflix.com/title/81280792"
  local URL_REGIONAL="https://www.netflix.com/title/70143836"
  local UA_Browser="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.87 Safari/537.36"


  # 根据 WARP interface 、 Client 和 Wireproxy 的安装情况判断刷 IP 的方式
  INSTALL_CHECK=("wg-quick" "warp-cli" "wireproxy")
  CASE_RESAULT=("0 0 0" "0 0 1" "0 1 0" "0 1 1" "1 0 0" "1 0 1" "1 1 0" "1 1 1")
  SHOW_CHOOSE=("$(text 115)" "" "" "$(text 116)" "" "$(text 117)" "$(text 118)" "$(text 119)")
  CHANGE_IP1=("" "change_wireproxy" "change_client" "change_client" "change_warp" "change_warp" "change_warp" "change_warp")
  CHANGE_IP2=("" "" "" "change_wireproxy" "" "change_wireproxy" "change_client" "change_client")
  CHANGE_IP3=("" "" "" "" "" "" "" "change_wireproxy")

  for a in ${!INSTALL_CHECK[@]}; do
    [ -x "$(type -p ${INSTALL_CHECK[a]})" ] && INSTALL_RESULT[a]=1 || INSTALL_RESULT[a]=0
  done

  for b in ${!CASE_RESAULT[@]}; do
    [[ "${INSTALL_RESULT[@]}" = "${CASE_RESAULT[b]}" ]] && break
  done

  case "$b" in
    0 )
      error " $(text 115) "
      ;;
    1|2|4 )
      ${CHANGE_IP1[b]}
      ;;
    * )
      hint "\n ${SHOW_CHOOSE[b]} \n" && reading " $(text 50) " MODE
      case "$MODE" in
        [1-3] )
          $(eval echo "\${CHANGE_IP$MODE[b]}")
          ;;
        * )
          warning " $(text 51) [1-3] "; sleep 1; change_ip
      esac
  esac
}

# 安装BBR
bbrInstall() {
  echo -e "\n==============================================================\n"
  info " $(text 47) "
  echo -e "\n==============================================================\n"
  hint " 1. $(text 48) "
  [ "$OPTION" != b ] && hint " 0. $(text 49) \n" || hint " 0. $(text 76) \n"
  reading " $(text 50) " BBR
  case "$BBR" in
    1 )
      wget --no-check-certificate -N "${GH_PROXY}https://raw.githubusercontent.com/ylx2016/Linux-NetSpeed/master/tcp.sh" && chmod +x tcp.sh && ./tcp.sh
      ;;
    0 )
      [ "$OPTION" != b ] && menu || exit
      ;;
    * )
      warning " $(text 51) [0-1]"; sleep 1; bbrInstall
  esac
}

# 关闭 WARP 网络接口，并删除 WARP
uninstall() {
  unset IP4 IP6 WAN4 WAN6 COUNTRY4 COUNTRY6 ASNORG4 ASNORG6

  # 卸载 WARP
  uninstall_warp() {
    wg-quick down warp >/dev/null 2>&1
    systemctl disable --now wg-quick@warp >/dev/null 2>&1; sleep 3
    [ -x "$(type -p rpm)" ] && rpm -e wireguard-tools 2>/dev/null
    systemctl restart systemd-resolved >/dev/null 2>&1; sleep 3
    warp_api "cancel" "/etc/wireguard/warp-account.conf" >/dev/null 2>&1
    rm -rf /usr/bin/wireguard-go /usr/bin/warp /etc/dnsmasq.d/warp.conf /usr/bin/wireproxy /etc/local.d/warp.start
    [ -e /etc/gai.conf ] && sed -i '/^precedence \:\:ffff\:0\:0/d;/^label 2002\:\:\/16/d' /etc/gai.conf
    [ -e /usr/bin/tun.sh ] && rm -f /usr/bin/tun.sh
    [ -e /etc/crontab ] && sed -i '/tun.sh/d' /etc/crontab
    [ -e /etc/iproute2/rt_tables ] && sed -i "/250   warp/d" /etc/iproute2/rt_tables
    [ -e /etc/resolv.conf.origin ] && mv -f /etc/resolv.conf.origin /etc/resolv.conf
  }

  # 卸载 Linux Client
  uninstall_client() {
    [ "$(warp-cli --accept-tos settings | awk '/Mode:/{for (i=0; i<NF; i++) if ($i=="Mode:") {print $(i+1)}}')" = 'Warp' ] && rule_del >/dev/null 2>&1
    warp-cli --accept-tos disconnect >/dev/null 2>&1
    warp-cli --accept-tos registration delete >/dev/null 2>&1
    systemctl disable --now warp-svc >/dev/null 2>&1
    ${PACKAGE_UNINSTALL[int]} cloudflare-warp 2>/dev/null
    rm -rf /usr/bin/wireguard-go /usr/bin/warp $HOME/.local/share/warp /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg /etc/apt/sources.list.d/cloudflare-client.list /etc/yum.repos.d/cloudflare-warp.repo
  }

  # 卸载 Wireproxy
  uninstall_wireproxy() {
    if [ "$SYSTEM" = Alpine ]; then
      rc-update del wireproxy default
      rc-service wireproxy stop >/dev/null 2>&1
      rm -f /etc/init.d/wireproxy
    else
      systemctl disable --now wireproxy
    fi

    warp_api "cancel" "/etc/wireguard/warp-account.conf" >/dev/null 2>&1
    rm -rf /usr/bin/wireguard-go /usr/bin/warp /etc/dnsmasq.d/warp.conf /usr/bin/wireproxy /lib/systemd/system/wireproxy.service
    [ -e /etc/gai.conf ] && sed -i '/^precedence \:\:ffff\:0\:0/d;/^label 2002\:\:\/16/d' /etc/gai.conf
    [ -e /usr/bin/tun.sh ] && rm -f /usr/bin/tun.sh && sed -i '/tun.sh/d' /etc/crontab
  }

  # 如已安装 warp_unlock 项目，先行卸载
  [ -e /usr/bin/warp_unlock.sh ] && bash <(curl -sSL https://gitlab.com/fscarmen/warp_unlock/-/raw/main/unlock.sh) -U -$L

  # 根据已安装情况执行卸载任务并显示结果
  [[ "$SYSTEM" = 'Ubuntu' && "$MAJOR_VERSION" -ge 24 ]] && RESOLVER_PKG=resolvconf || RESOLVER_PKG=openresolv

  UNINSTALL_CHECK=("wg-quick" "warp-cli" "wireproxy")
  UNINSTALL_DO=("uninstall_warp" "uninstall_client" "uninstall_wireproxy")
  UNINSTALL_DEPENDENCIES=("wireguard-tools $RESOLVER_PKG " "" " $RESOLVER_PKG ")
  UNINSTALL_NOT_ARCH=("wireguard-dkms " "" "wireguard-dkms $RESOLVER_PKG ")
  UNINSTALL_DNSMASQ=("ipset dnsmasq $RESOLVER_PKG ")
  UNINSTALL_RESULT=("$(text 62)" "$(text 53)" "$(text 98)")
  for i in ${!UNINSTALL_CHECK[@]}; do
    [ -x "$(type -p ${UNINSTALL_CHECK[i]})" ] && UNINSTALL_DO_LIST[i]=1 && UNINSTALL_DEPENDENCIES_LIST+=${UNINSTALL_DEPENDENCIES[i]}
    [[ $SYSTEM != "Arch" && $(dkms status 2>/dev/null) =~ wireguard ]] && UNINSTALL_DEPENDENCIES_LIST+=${UNINSTALL_NOT_ARCH[i]}
    [ -e /etc/dnsmasq.d/warp.conf ] && UNINSTALL_DEPENDENCIES_LIST+=${UNINSTALL_DNSMASQ[i]}
  done

  # 列出依赖，确认是手动还是自动卸载
  UNINSTALL_DEPENDENCIES_LIST=$(awk '{for(i=1;i<=NF;i++) if(!seen[$i]++) printf("%s%s",(c++?" ":""),$i)}' <<< "$UNINSTALL_DEPENDENCIES_LIST")
  [ "$UNINSTALL_DEPENDENCIES_LIST" != '' ] && hint "\n $(text 79) \n" && reading " $(text 133) " CONFIRM_UNINSTALL

  # 卸载核心程序
  for i in ${!UNINSTALL_CHECK[@]}; do
    [[ "${UNINSTALL_DO_LIST[i]}" = 1 ]] && ( ${UNINSTALL_DO[i]}; info " ${UNINSTALL_RESULT[i]} " )
  done

  # 删除本脚本安装在 /etc/wireguard/ 下的所有文件，如果删除后目录为空，一并把目录删除
  if [ -s /usr/bin/wg-quick.origin ]; then
    # 检查是否需要还原wg-quick.origin文件
    grep -q '^#[[:space:]]\+add_if$' /usr/bin/wg-quick.origin && sed -i 's/#\([[:space:]]\+add_if\)/\1/; /wireguard-go "$INTERFACE"/d' /usr/bin/wg-quick.origin
    mv -f /usr/bin/wg-quick.origin /usr/bin/wg-quick
  fi
  rm -f /usr/bin/wg-quick.{origin,reserved}
  rm -f /tmp/{best_mtu,wireguard-go-*}
  rm -f /etc/wireguard/{warp-account.conf,warp_unlock.sh,warp.conf,up,down,proxy.conf,menu.sh,language,NonGlobalUp.sh,NonGlobalDown.sh}
  [[ -e /etc/wireguard && -z "$(ls -A /etc/wireguard/)" ]] && rmdir /etc/wireguard

  # 选择自动卸载依赖执行以下
  [[ "$UNINSTALL_DEPENDENCIES_LIST" != '' && "${CONFIRM_UNINSTALL,,}" = 'y' ]] && ( ${PACKAGE_UNINSTALL[int]} $UNINSTALL_DEPENDENCIES_LIST 2>/dev/null; info " $(text 134) \n" )

  # 显示卸载结果
  systemctl restart systemd-resolved >/dev/null 2>&1; sleep 3
  ip_case u warp
  info " $(text 45)\n IPv4: $WAN4 $COUNTRY4 $ASNORG4\n IPv6: $WAN6 $COUNTRY6 $ASNORG6 "
}

# 同步脚本至最新版本
ver() {
  mkdir -p /tmp; rm -f /tmp/menu.sh
  wget -O /tmp/menu.sh https://gitlab.com/fscarmen/warp/-/raw/main/menu.sh
  if [ -s /tmp/menu.sh ]; then
    mv /tmp/menu.sh /etc/wireguard/
    chmod +x /etc/wireguard/menu.sh
    ln -sf /etc/wireguard/menu.sh /usr/bin/warp
    info " $(text 64):$(grep ^VERSION /etc/wireguard/menu.sh | sed "s/.*=//g")  $(text 18):$(grep "${L}\[1\]" /etc/wireguard/menu.sh | cut -d \" -f2) "
  else
    error " $(text 65) "
  fi
  exit
}

# 由于warp bug，有时候获取不了ip地址，加入刷网络脚本手动运行，并在定时任务加设置 VPS 重启后自动运行,i=当前尝试次数，j=要尝试的次数
net() {
  local NO_OUTPUT="$1"
  unset IP4 IP6 WAN4 WAN6 COUNTRY4 COUNTRY6 ASNORG4 ASNORG6 WARPSTATUS4 WARPSTATUS6 TYPE
  [ ! -x "$(type -p wg-quick)" ] && error " $(text 10) "
  [ ! -e /etc/wireguard/warp.conf ] && error " $(text 108) "
  local i=1; local j=5
  local RETRY_BY_WIREGUARD_GO_DONE=0
  hint " $(text 11)\n $(text 12) "
  [ "$SYSTEM" != Alpine ] && [[ $(systemctl is-active wg-quick@warp) != 'active' ]] && wg-quick down warp >/dev/null 2>&1
  ${SYSTEMCTL_START[int]} >/dev/null 2>&1
  wg-quick up warp >/dev/null 2>&1
  ss -nltp | grep dnsmasq >/dev/null 2>&1 && systemctl restart dnsmasq >/dev/null 2>&1

  PING6='ping -6' && [ -x "$(type -p ping6)" ] && PING6='ping6'
  LAN4=$(ip route get 192.168.193.10 2>/dev/null | awk '{for (i=0; i<NF; i++) if ($i=="src") {print $(i+1)}}')
  LAN6=$(ip route get 2606:4700:d0::a29f:c001 2>/dev/null | awk '{for (i=0; i<NF; i++) if ($i=="src") {print $(i+1)}}')
  if [[ $(ip link show | awk -F': ' '{print $2}') =~ warp ]]; then
    grep -q '#Table' /etc/wireguard/warp.conf && GLOBAL_OR_NOT="$(text 95)" || GLOBAL_OR_NOT="$(text 96)"
    if grep -q '^AllowedIPs.*:\:\/0' 2>/dev/null /etc/wireguard/warp.conf; then
      local NET_6_NONGLOBAL=1
      ip_case 6 warp non-global
    else
      [[ "$LAN6" =~ ^[a-f0-9:]{1,}$ ]] && $PING6 -c2 -w10 2606:4700:d0::a29f:c001 >/dev/null 2>&1 && local NET_6_NONGLOBAL=0 && ip_case 6 warp
    fi
    if grep -q '^AllowedIPs.*0\.\0\/0' 2>/dev/null /etc/wireguard/warp.conf; then
      local NET_4_NONGLOBAL=1
      ip_case 4 warp non-global
    else
      [[ "$LAN4" =~ ^([0-9]{1,3}\.){3} ]] && ping -c2 -W3 162.159.192.1 >/dev/null 2>&1 && local NET_4_NONGLOBAL=0 && ip_case 4 warp
    fi
  else
    [[ "$LAN6" =~ ^[a-f0-9:]{1,}$ ]] && INET6=1 && $PING6 -c2 -w10 2606:4700:d0::a29f:c001 >/dev/null 2>&1 && local NET_6_NONGLOBAL=0 && ip_case 6 warp
    [[ "$LAN4" =~ ^([0-9]{1,3}\.){3} ]] && INET4=1 && ping -c2 -W3 162.159.192.1 >/dev/null 2>&1 && local NET_4_NONGLOBAL=0 && ip_case 4 warp
  fi

  until [[ "$TRACE4$TRACE6" =~ on|plus ]]; do
    (( i++ )) || true
    hint " $(text 12) "
    ${SYSTEMCTL_RESTART[int]} >/dev/null 2>&1
    ss -nltp | grep dnsmasq >/dev/null 2>&1 && systemctl restart dnsmasq >/dev/null 2>&1

    case "$NET_6_NONGLOBAL" in
      0 )
        ip_case 6 warp
        ;;
      1 )
        ip_case 6 warp non-global
    esac

    case "$NET_4_NONGLOBAL" in
      0 )
        ip_case 4 warp
        ;;
      1 )
        ip_case 4 warp non-global
    esac

    if [ "$i" = "$j" ]; then
      if [ "$RETRY_BY_WIREGUARD_GO_DONE" = 0 ] && [ "$KERNEL_OR_WIREGUARD_GO" = 'wireguard kernel' ] && [ "$WIREGUARD_GO_ENABLE" = '1' ] && [ -x /usr/bin/wireguard-go ] && [ -e /usr/bin/wg-quick.reserved ]; then
        RETRY_BY_WIREGUARD_GO_DONE=1
        warning " $(text 140) "
        ln -sf /usr/bin/wg-quick.reserved /usr/bin/wg-quick
        KERNEL_OR_WIREGUARD_GO='wireguard-go with reserved'
        wg-quick down warp >/dev/null 2>&1
        [ -s /etc/resolv.conf.origin ] && cp -f /etc/resolv.conf.origin /etc/resolv.conf
        unset IP4 IP6 WAN4 WAN6 COUNTRY4 COUNTRY6 ASNORG4 ASNORG6 TRACE4 TRACE6 PLUS4 PLUS6 WARPSTATUS4 WARPSTATUS6 TYPE
        i=1
        hint " $(text 11)\n $(text 12) "
        ${SYSTEMCTL_START[int]} >/dev/null 2>&1
        wg-quick up warp >/dev/null 2>&1
        ss -nltp | grep dnsmasq >/dev/null 2>&1 && systemctl restart dnsmasq >/dev/null 2>&1
        continue
      fi
      wg-quick down warp >/dev/null 2>&1
      ERROR_MESSAGE=$(wg-quick up warp 2>&1)
      wg-quick down warp >/dev/null 2>&1
      [ -s /etc/resolv.conf.origin ] && cp -f /etc/resolv.conf.origin /etc/resolv.conf
      echo -e " ↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓\n $(text 20): $SYS\n\n $(text 21):$(uname -r) \n\n $(text 40): ${MENU_OPTION[MENU_CHOOSE]} \n\n $ERROR_MESSAGE\n ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑ "
      error " $(text 13) "
    fi
  done

  if [[ "$TRACE4$TRACE6" =~ on|plus ]]; then
    [[ "$TRACE4$TRACE6" =~ plus ]] && TYPE='+' || TYPE=' Free'
    info " $(text 14), $(text 46) "
    [ "$NO_OUTPUT" != 'no_output' ] && info " IPv4:$WAN4 $COUNTRY4 $ASNORG4\n IPv6:$WAN6 $COUNTRY6 $ASNORG6 "
  fi
}

# WARP 开关，先检查是否已安装，再根据当前状态转向相反状态
onoff() {
  [ ! -x "$(type -p wg-quick)" ] && error " $(text 120) "
  wg show warp >/dev/null 2>&1 && (wg-quick down warp >/dev/null 2>&1; info " $(text 15) ") || net
}

# Client 开关，先检查是否已安装，再根据当前状态转向相反状态
client_onoff() {
  [ ! -x "$(type -p warp-cli)" ] && error " $(text 93) "
  if [ "$(warp-cli --accept-tos status | awk '/Status update/{for (i=0; i<NF; i++) if ($i=="update:") {print $(i+1)}}')" = 'Connected' ]; then
    local CLIENT_MODE=$(warp-cli --accept-tos settings | awk '/Mode:/{for (i=0; i<NF; i++) if ($i=="Mode:") {print $(i+1)}}')
    [ "$CLIENT_MODE" = 'Warp' ] && rule_del >/dev/null 2>&1
    warp-cli --accept-tos disconnect >/dev/null 2>&1
    info " $(text 91) " && exit 0
  else
    warp-cli --accept-tos connect >/dev/null 2>&1
    local CLIENT_MODE=$(warp-cli --accept-tos settings | awk '/Mode:/{for (i=0; i<NF; i++) if ($i=="Mode:") {print $(i+1)}}')
    if [ "$CLIENT_MODE" = 'WarpProxy' ]; then
      wait_for socks5 >/dev/null 2>&1
      ip_case d client
      local CLIENT_ACCOUNT=$(warp-cli --accept-tos registration show 2>/dev/null | awk  '/type/{print $3}')
      [ "$CLIENT_ACCOUNT" = Limited ] && CLIENT_AC='+'
      [[ $(ss -nltp | awk '{print $NF}' | awk -F \" '{print $2}') =~ warp-svc ]] && info " $(text 90)\n $(text 27): $CLIENT_SOCKS5\n WARP$CLIENT_AC IPv4: $CLIENT_WAN4 $CLIENT_COUNTRY4 $CLIENT_ASNORG4\n WARP$CLIENT_AC IPv6: $CLIENT_WAN6 $CLIENT_COUNTRY6 $CLIENT_ASNORG6 "
      exit 0

    elif [ "$CLIENT_MODE" = 'Warp' ]; then
      wait_for interface >/dev/null 2>&1
      rule_add >/dev/null 2>&1
      ip_case d is_luban
      local CLIENT_ACCOUNT=$(warp-cli --accept-tos registration show 2>/dev/null | awk  '/type/{print $3}')
      [ "$CLIENT_ACCOUNT" = Limited ] && CLIENT_AC='+'
      [[ $(ip link show | awk -F': ' '{print $2}') =~ CloudflareWARP ]] && info " $(text 90)\n WARP$CLIENT_AC IPv4: $CFWARP_WAN4 $CFWARP_COUNTRY4  $CFWARP_ASNORG4\n WARP$CLIENT_AC IPv6: $CFWARP_WAN6 $CFWARP_COUNTRY6  $CFWARP_ASNORG6 "
      exit 0
    fi
  fi
}

# WireProxy 开关，先检查是否已安装，再根据当前状态转向相反状态
wireproxy_onoff() {
  local NO_OUTPUT="$1"
  [ ! -x "$(type -p wireproxy)" ] && error " $(text 122) " || IS_PUFFERFFISH=is_pufferffish
  if ss -nltp | awk '{print $NF}' | awk -F \" '{print $2}' | grep -q wireproxy; then
    [ "$SYSTEM" = Alpine ] && rc-service wireproxy stop >/dev/null 2>&1 || systemctl stop wireproxy
    [[ ! $(ss -nltp | awk '{print $NF}' | awk -F \" '{print $2}') =~ wireproxy ]] && info " $(text 123) "
  else
    local i=1; local j=5
    hint " $(text 11)\n $(text 12) "
    [ "$SYSTEM" = Alpine ] && rc-service wireproxy start >/dev/null 2>&1 || systemctl start wireproxy; sleep 1
    ip_case d wireproxy

    until [[ "$WIREPROXY_TRACE4$WIREPROXY_TRACE6" =~ on|plus ]]; do
      (( i++ )) || true
      hint " $(text 12) "
      [ "$SYSTEM" = Alpine ] && rc-service wireproxy restart >/dev/null 2>&1 || systemctl restart wireproxy; sleep 1
      ip_case d wireproxy
      if [[ "$i" -gt "$j" ]]; then
        [ "$SYSTEM" = Alpine ] && rc-service wireproxy stop >/dev/null 2>&1 || systemctl stop wireproxy
        error " $(text 13) "
      fi
    done

    if [[ "$NO_OUTPUT" != 'no_output' && "$WIREPROXY_TRACE4$WIREPROXY_TRACE6" =~ on|plus ]]; then
      [[ $(ss -nltp | awk '{print $NF}' | awk -F \" '{print $2}') =~ wireproxy ]] && info " $(text 99)\n $(text 27): $WIREPROXY_SOCKS5\n WARP$WIREPROXY_ACCOUNT\n IPv4: $WIREPROXY_WAN4 $WIREPROXY_COUNTRY4 $WIREPROXY_ASNORG4\n IPv6: $WIREPROXY_WAN6 $WIREPROXY_COUNTRY6 $WIREPROXY_ASNORG6"
    fi
  fi
}

# 检查系统 WARP 单双栈情况。为了速度，先检查 warp 配置文件里的情况，再判断 trace
check_stack() {
  if [ -e /etc/wireguard/warp.conf ]; then
    grep -q "^#.*0\.\0\/0" 2>/dev/null /etc/wireguard/warp.conf && T4=0 || T4=1
    grep -q "^#.*\:\:\/0" 2>/dev/null /etc/wireguard/warp.conf && T6=0 || T6=1
  else
    case "$TRACE4" in
      off )
        T4='0'
        ;;
      'on'|'plus' )
        T4='1'
    esac
    case "$TRACE6" in
      off )
        T6='0'
        ;;
      'on'|'plus' )
        T6='1'
    esac
  fi
  CASE=("@0" "0@" "0@0" "@1" "0@1" "1@" "1@0" "1@1" "@")
  for m in ${!CASE[@]}; do
    [ "$T4"@"$T6" = "${CASE[m]}" ] && break
  done
  WARP_BEFORE=("" "" "" "WARP IPv6 only" "WARP IPv6" "WARP IPv4 only" "WARP IPv4" "$(text 70)")
  WARP_AFTER1=("" "" "" "WARP IPv4" "WARP IPv4" "WARP IPv6" "WARP IPv6" "WARP IPv4")
  WARP_AFTER2=("" "" "" "$(text 70)" "$(text 70)" "$(text 70)" "$(text 70)" "WARP IPv6")
  TO1=("" "" "" "014" "014" "106" "106" "114")
  TO2=("" "" "" "01D" "01D" "10D" "10D" "116")
  SHORTCUT1=("" "" "" "(warp 4)" "(warp 4)" "(warp 6)" "(warp 6)" "(warp 4)")
  SHORTCUT2=("" "" "" "(warp d)" "(warp d)" "(warp d)" "(warp d)" "(warp 6)")

  # 判断用于检测 NAT VSP，以选择正确配置文件
  if [ "$m" -le 3 ]; then
    NAT=("0@1@" "1@0@1" "1@1@1" "0@1@1")
    for n in ${!NAT[@]}; do [ "$IPV4@$IPV6@$INET4" = "${NAT[n]}" ] && break; done
    NATIVE=("IPv6 only" "IPv4 only" "$(text 69)" "NAT IPv4")
    CONF1=("014" "104" "114" "11N4")
    CONF2=("016" "106" "116" "11N6")
    CONF3=("01D" "10D" "11D" "11ND")
  elif [ "$m" = 8 ]; then
    error "\n $(text 100) \n"
  fi
}

# 对于 CentOS 9 / AlmaLinux 9 / RockyLinux 9 及类似的系统，由于 wg-quick 不能对 openresolv 进行操作，所以直接处理 /etc/resolv.conf 文件
centos9_resolv() {
  local EXECUTE=$1
  local STACK=$2
  if [ "$EXECUTE" = 'backup' ]; then
    cp -f /etc/resolv.conf{,.origin}
  elif [ "$EXECUTE" = 'generate' ]; then
    [ "$STACK" = '0' ] && echo -e "# Generated by WARP script\nnameserver 2606:4700:4700::1111\nnameserver 2001:4860:4860::8888\nnameserver 2001:4860:4860::8844\nnameserver 1.1.1.1\nnameserver 8.8.8.8\nnameserver 8.8.4.4" > /etc/resolv.conf || echo -e "# Generated by WARP script\nnameserver 1.1.1.1\nnameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 2606:4700:4700::1111\nnameserver 2001:4860:4860::8888\nnameserver 2001:4860:4860::8844" > /etc/resolv.conf
  elif [ "$EXECUTE" = 'restore' ]; then
    [ -s /etc/resolv.conf.origin ] && mv -f /etc/resolv.conf.origin /etc/resolv.conf
  fi
}

# 单双栈在线互换。先看菜单是否有选择，再看传参数值，再没有显示2个可选项
stack_switch() {
  # WARP 单双栈切换选项
  SWITCH014="/AllowedIPs/s/#//g;s/^.*\:\:\/0/#&/g"
  SWITCH01D="/AllowedIPs/s/#//g"
  SWITCH106="/AllowedIPs/s/#//g;s/^.*0\.\0\/0/#&/g"
  SWITCH10D="/AllowedIPs/s/#//g"
  SWITCH114="/AllowedIPs/s/^.*\:\:\/0/#&/g"
  SWITCH116="/AllowedIPs/s/^.*0\.\0\/0/#&/g"

  [[ "$CLIENT" = [35] && "$SWITCHCHOOSE" = [4D] ]] && error " $(text 109) "
  check_stack
  if [[ "$MENU_CHOOSE" = [12] ]]; then
    TO=$(eval echo "\${TO$MENU_CHOOSE[m]}")
  elif [[ "$SWITCHCHOOSE" = [46D] ]]; then
    [[ "$T4@$T6@$SWITCHCHOOSE" =~ '1@0@4'|'0@1@6'|'1@1@D' ]] && error "\n $(text 111) \n" || TO="$T4$T6$SWITCHCHOOSE"
  fi
  [ "${#TO}" != 3 ] && error " $(text 135) " || sed -i "$(eval echo "\$SWITCH$TO")" /etc/wireguard/warp.conf
  ${SYSTEMCTL_RESTART[int]}; sleep 1
  net
}

# 内核 / wireguard-go with reserved 在线互换
kernel_reserved_switch() {
  # 先判断是否可以转换
  case "$KERNEL_ENABLE@$WIREGUARD_GO_ENABLE" in
    0@1 )
      KERNEL_OR_WIREGUARD_GO='wireguard-go with reserved' && error "\n $(text 136) \n"
      ;;
    1@0 )
      KERNEL_OR_WIREGUARD_GO='wireguard kernel' && error "\n $(text 136) \n"
      ;;
    1@1 )
      if grep -q '^#[[:space:]]*add_if' /usr/bin/wg-quick; then
        WIREGUARD_BEFORE='wireguard-go with reserved'; WIREGUARD_AFTER='wireguard kernel'; local CP_FILE=origin
      else
        WIREGUARD_BEFORE='wireguard kernel'; WIREGUARD_AFTER='wireguard-go with reserved'; local CP_FILE=reserved
      fi

      reading "\n $(text 138) " CONFIRM_WIREGUARD_CHANGE
      if [ "${CONFIRM_WIREGUARD_CHANGE,,}" = 'y' ]; then
        wg-quick down warp >/dev/null 2>&1
        ln -sf /usr/bin/wg-quick.$CP_FILE /usr/bin/wg-quick
        net
      else
        exit
      fi
  esac
}

# 全局 / 非全局 在线互换
working_mode_switch() {
  # 先判断当前工作模式
  if grep -q '#Table' /etc/wireguard/warp.conf; then
    MODE_BEFORE="$(text 95)"; MODE_AFTER="$(text 96)"
  else
    MODE_BEFORE="$(text 96)"; MODE_AFTER="$(text 95)"
  fi

  reading "\n $(text 26) " CONFIRM_MODE_CHANGE
  if [ "${CONFIRM_MODE_CHANGE,,}" = 'y' ]; then
    wg-quick down warp >/dev/null 2>&1
    [ "$MODE_AFTER" = "$(text 96)" ] && sed -i "/Table/s/#//g;/NonGlobal/s/#//g" /etc/wireguard/warp.conf || sed -i "s/^Table/#Table/g; /NonGlobal/s/^/#&/g" /etc/wireguard/warp.conf
    net
  else
    exit
  fi
}

# 检测系统信息
check_system_info() {
  info " $(text 37) "

  # 判断是否有加载 wireguard 内核，如没有先尝试是否可以加载，再重新判断一次
  if [ ! -e /sys/module/wireguard ]; then
    [ -s /lib/modules/$(uname -r)/kernel/drivers/net/wireguard/wireguard.ko* ] && [ -x "$(type -p lsmod)" ] && ! lsmod | grep -q wireguard && [ -x "$(type -p modprobe)" ] && modprobe wireguard
    [ -e /sys/module/wireguard ] && KERNEL_ENABLE=1 || KERNEL_ENABLE=0
  else
    KERNEL_ENABLE=1
  fi

  # 必须加载 TUN 模块，先尝试在线打开 TUN。尝试成功放到启动项，失败作提示并退出脚本
  TUN=$(cat /dev/net/tun 2>&1)
  if [[ "$TUN" =~ 'in bad state'|'处于错误状态' ]]; then
    WIREGUARD_GO_ENABLE=1
  else
    cat >/usr/bin/tun.sh << EOF
#!/usr/bin/env bash

mkdir -p /dev/net
mknod /dev/net/tun c 10 200 2>/dev/null
[ ! -e /dev/net/tun ] && exit 1
chmod 0666 /dev/net/tun
EOF
    chmod +x /usr/bin/tun.sh
    /usr/bin/tun.sh
    TUN=$(cat /dev/net/tun 2>&1)
    if [[ "$TUN" =~ 'in bad state'|'处于错误状态' ]]; then
      WIREGUARD_GO_ENABLE=1
      [ "$SYSTEM" != Alpine ] && echo "@reboot root bash /usr/bin/tun.sh" >> /etc/crontab
    else
      WIREGUARD_GO_ENABLE=0
      rm -f /usr/bin/tun.sh
    fi
  fi

  # 判断机器原生状态类型
  IPV4=0; IPV6=0
  LAN4=$(ip route get 192.168.193.10 2>/dev/null | awk '{for (i=0; i<NF; i++) if ($i=="src") {print $(i+1)}}')
  LAN6=$(ip route get 2606:4700:d0::a29f:c001 2>/dev/null | awk '{for (i=0; i<NF; i++) if ($i=="src") {print $(i+1)}}')

  # 先查是否非局，优先 warp IP，再原生 IP
  if [[ $(ip link show | awk -F': ' '{print $2}') =~ warp ]]; then
    GLOBAL_OR_NOT="$(text 96)"
    if grep -q '^AllowedIPs.*:\:\/0' 2>/dev/null /etc/wireguard/warp.conf; then
      STACK=-6 && ip_case 6 warp non-global
    else
      [[ "$LAN6" != "::1" && "$LAN6" =~ ^[a-f0-9:]+$ ]] && INET6=1 && $PING6 -c2 -w10 2606:4700:d0::a29f:c001 >/dev/null 2>&1 && IPV6=1 && STACK=-6 && ip_case 6 warp
    fi
    if grep -q '^AllowedIPs.*0\.\0\/0' 2>/dev/null /etc/wireguard/warp.conf; then
      STACK=-4 && ip_case 4 warp non-global
    else
      [[ "$LAN4" =~ ^([0-9]{1,3}\.){3} ]] && INET4=1 && ping -c2 -W3 162.159.192.1 >/dev/null 2>&1 && IPV4=1 && STACK=-4 && ip_case 4 warp
    fi
  else
    [[ "$LAN6" != "::1" && "$LAN6" =~ ^[a-f0-9:]+$ ]] && INET6=1 && $PING6 -c2 -w10 2606:4700:d0::a29f:c001 >/dev/null 2>&1 && IPV6=1 && STACK=-6 && ip_case 6 warp
    [[ "$LAN4" =~ ^([0-9]{1,3}\.){3} ]] && INET4=1 && ping -c2 -W3 162.159.192.1 >/dev/null 2>&1 && IPV4=1 && STACK=-4 && ip_case 4 warp
  fi

  # 判断当前 WARP 状态，决定变量 PLAN，变量 PLAN 含义:1=单栈  2=双栈  3=WARP已开启
  [[ "$TRACE4$TRACE6" =~ on|plus ]] && PLAN=3 || PLAN=$((IPV4+IPV6))

  # 判断处理器架构
  case $(uname -m) in
    aarch64 )
      ARCHITECTURE=arm64
      ;;
    x86_64 )
      ARCHITECTURE=amd64
      ;;
    s390x )
      ARCHITECTURE=s390x; CLIENT_NOT_ALLOWED_ARCHITECTURE="$(text 121)"
      ;;
    * )
      error " $(text 42) "
  esac

  # 判断当前 Linux Client 状态，决定变量 CLIENT，变量 CLIENT 含义:0=未安装  1=已安装未激活  2=状态激活  3=Client proxy 已开启  5=Client warp 已开启
  CLIENT=0
  if [ -x "$(type -p warp-cli)" ]; then
    CLIENT=1 && CLIENT_INSTALLED="$(text 92)"
    [ "$(systemctl is-enabled warp-svc)" = enabled ] && CLIENT=2
    if [[ "$CLIENT" = 2 && "$(systemctl is-active warp-svc)" = 'active' ]]; then
      local CLIENT_ACCOUNT=$(warp-cli --accept-tos registration show 2>/dev/null | awk  '/type/{print $3}')
      [ "$CLIENT_ACCOUNT" = Limited ] && CLIENT_AC='+'
      local CLIENT_MODE=$(warp-cli --accept-tos settings | awk '/Mode:/{for (i=0; i<NF; i++) if ($i=="Mode:") {print $(i+1)}}')
      case "$CLIENT_MODE" in
        WarpProxy )
          [[ "$(ss -nltp | awk '{print $NF}' | awk -F \" '{print $2}')" =~ warp-svc ]] && CLIENT=3 && ip_case d client
          ;;
        Warp )
          [[ "$(ip link show | awk -F': ' '{print $2}')" =~ CloudflareWARP ]] && CLIENT=5 && ip_case d is_luban
      esac
    fi
  fi

  # 判断当前 WireProxy 状态，决定变量 WIREPROXY，变量 WIREPROXY 含义:0=未安装，1=已安装,断开状态，2=Client 已开启
  WIREPROXY=0
  if [ -x "$(type -p wireproxy)" ]; then
    WIREPROXY=1
    [ "$WIREPROXY" = 1 ] && WIREPROXY_INSTALLED="$(text 92)" && [[ "$(ss -nltp | awk '{print $NF}' | awk -F \" '{print $2}')" =~ wireproxy ]] && WIREPROXY=2 && ip_case d wireproxy
  fi
}

rule_add() {
  ip -4 rule show | grep -q "from 172.16.0.2 lookup 51820" || ip -4 rule add from 172.16.0.2 lookup 51820
  ip link show CloudflareWARP >/dev/null 2>&1 && ip -4 route add default dev CloudflareWARP table 51820 2>/dev/null
  ip -4 rule show | grep -q "from all lookup main suppress_prefixlength 0" || ip -4 rule add table main suppress_prefixlength 0
  ip -6 rule show | grep -q "oif CloudflareWARP lookup 51820" || ip -6 rule add oif CloudflareWARP lookup 51820
  ip link show CloudflareWARP >/dev/null 2>&1 && ip -6 route add default dev CloudflareWARP table 51820 2>/dev/null
  ip -6 rule show | grep -q "from all lookup main suppress_prefixlength 0" || ip -6 rule add table main suppress_prefixlength 0
}

rule_del() {
  ip -4 rule show | grep -q "from 172.16.0.2" && ip -4 rule delete from 172.16.0.2 lookup 51820
  ip -4 rule show | grep -q "suppress_prefixlength 0" && ip -4 rule delete table main suppress_prefixlength 0
  ip -6 rule show | grep -q "oif CloudflareWARP" && ip -6 rule delete oif CloudflareWARP lookup 51820
  ip -6 rule show | grep -q "suppress_prefixlength 0" && ip -6 rule delete table main suppress_prefixlength 0
}

# 输入 Linux Client 端口,先检查默认的40000是否被占用,限制4-5位数字,准确匹配空闲端口
input_port() {
  i=5
  PORT=40000
  ss -nltp | awk '{print $4}' | awk -F: '{print $NF}' | grep -qw $PORT && reading " $(text 103) " PORT || reading " $(text 104) " PORT
  PORT=${PORT:-'40000'}
  until grep -qE "^[1-9][0-9]{3,4}$" <<< $PORT && [[ "$PORT" -ge 1000 && "$PORT" -le 65535 ]] && [[ ! $(ss -nltp) =~ :"$PORT"[[:space:]] ]]; do
    (( i-- )) || true
    [ "$i" = 0 ] && error " $(text 29) "
    if grep -qwE "^[1-9][0-9]{3,4}$" <<< $PORT; then
      if [[ "$PORT" -ge 1000 && "$PORT" -le 65535 ]]; then
        ss -nltp | awk '{print $4}' | awk -F: '{print $NF}' | grep -qw $PORT && reading " $(text 103) " PORT
      else
        reading " $(text 9) " PORT
        PORT=${PORT:-'40000'}
      fi
    else
      reading " $(text 9) " PORT
      PORT=${PORT:-'40000'}
    fi
  done
}

# Linux Client 或 WireProxy 端口
change_port() {
  socks5_port() { input_port; warp-cli --accept-tos proxy port "$PORT"; }
  wireproxy_port() {
    input_port
    sed -i "s/BindAddress.*/BindAddress = 127.0.0.1:$PORT/g" /etc/wireguard/proxy.conf
    systemctl restart wireproxy
  }

  INSTALL_CHECK=("$CLIENT" "$WIREPROXY")
  CASE_RESAULT=("0 1" "1 0" "1 1")
  SHOW_CHOOSE=("" "" "$(text 116)")
  CHANGE_PORT1=("wireproxy_port" "socks5_port" "socks5_port")
  CHANGE_PORT2=("" "" "wireproxy_port")

  for e in ${!INSTALL_CHECK[@]}; do
    [[ "${INSTALL_CHECK[e]}" -gt 1 ]] && INSTALL_RESULT[e]=1 || INSTALL_RESULT[e]=0
  done

  for f in ${!CASE_RESAULT[@]}; do
    [[ "${INSTALL_RESULT[@]}" = "${CASE_RESAULT[f]}" ]] && break
  done

  case "$f" in
    0|1 )
      ${CHANGE_PORT1[f]}
      wait_for $PORT
      ss -nltp | grep -q ":$PORT" && info " $(text 25) " || error " $(text 34) "
      ;;
    2 )
      hint " ${SHOW_CHOOSE[f]} " && reading " $(text 50) " MODE
        case "$MODE" in
          [1-2] )
            $(eval echo "\${CHANGE_IP$MODE[f]}")
            wait_for $PORT
            ss -nltp | grep -q ":$PORT" && info " $(text 25) " || error " $(text 34) "
            ;;
          * )
            warning " $(text 51) [1-2] "; sleep 1; change_port
        esac
  esac
}

# 选用 iptables+dnsmasq+ipset 方案执行
iptables_solution() {
  ${PACKAGE_INSTALL[int]} ipset dnsmasq resolvconf mtr

  # 创建 dnsmasq 规则文件
  cat >/etc/dnsmasq.d/warp.conf << EOF
#!/usr/bin/env bash
server=1.1.1.1
server=8.8.8.8
# ----- WARP ----- #
# > Youtube Premium
server=/googlevideo.com/8.8.8.8
server=/youtube.com/8.8.8.8
server=/youtubei.googleapis.com/8.8.8.8
server=/fonts.googleapis.com/8.8.8.8
server=/yt3.ggpht.com/8.8.8.8
server=/gstatic.com/8.8.8.8

# > Custom ChatGPT
ipset=/openai.com/warp
ipset=/ai.com/warp
ipset=/chatgpt.com/warp

# > IP api
ipset=/ip.sb/warp
ipset=/ip.gs/warp
ipset=/ifconfig.co/warp
ipset=/ip-api.com/warp

# > Custom Website
ipset=/www.cloudflare.com/warp
ipset=/googlevideo.com/warp
ipset=/youtube.com/warp
ipset=/youtubei.googleapis.com/warp
ipset=/fonts.googleapis.com/warp
ipset=/yt3.ggpht.com/warp

# > Netflix
ipset=/fast.com/warp
ipset=/netflix.com/warp
ipset=/netflix.net/warp
ipset=/nflxext.com/warp
ipset=/nflximg.com/warp
ipset=/nflximg.net/warp
ipset=/nflxso.net/warp
ipset=/nflxvideo.net/warp
ipset=/239.255.255.250/warp

# > TVBAnywhere+
ipset=/uapisfm.tvbanywhere.com.sg/warp

# > Disney+
ipset=/bamgrid.com/warp
ipset=/disney-plus.net/warp
ipset=/disneyplus.com/warp
ipset=/dssott.com/warp
ipset=/disneynow.com/warp
ipset=/disneystreaming.com/warp
ipset=/cdn.registerdisney.go.com/warp

# > TikTok
ipset=/byteoversea.com/warp
ipset=/ibytedtos.com/warp
ipset=/ipstatp.com/warp
ipset=/muscdn.com/warp
ipset=/musical.ly/warp
ipset=/tiktok.com/warp
ipset=/tik-tokapi.com/warp
ipset=/tiktokcdn.com/warp
ipset=/tiktokv.com/warp
EOF

  # 创建 PostUp 和 PreDown
  cat >/etc/wireguard/up << EOF
#!/usr/bin/env bash

ipset create warp hash:ip
iptables -t mangle -N fwmark
iptables -t mangle -A PREROUTING -j fwmark
iptables -t mangle -A OUTPUT -j fwmark
iptables -t mangle -A fwmark -m set --match-set warp dst -j MARK --set-mark 2
ip rule add fwmark 2 table warp
ip route add default dev warp table warp
iptables -t nat -A POSTROUTING -m mark --mark 0x2 -j MASQUERADE
iptables -t mangle -A POSTROUTING -o warp -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
EOF

  cat >/etc/wireguard/down << EOF
#!/usr/bin/env bash

iptables -t mangle -D PREROUTING -j fwmark
iptables -t mangle -D OUTPUT -j fwmark
iptables -t mangle -D fwmark -m set --match-set warp dst -j MARK --set-mark 2
ip rule del fwmark 2 table warp
iptables -t mangle -D POSTROUTING -o warp -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
iptables -t nat -D POSTROUTING -m mark --mark 0x2 -j MASQUERADE
iptables -t mangle -F fwmark
iptables -t mangle -X fwmark
sleep 2
ipset destroy warp
EOF

  chmod +x /etc/wireguard/up /etc/wireguard/down

  # 修改 warp.conf 和 warp.conf 文件
  sed -i "s/^Post.*/#&/g; /Table/s/#//g; /Table/a\PostUp = /etc/wireguard/up\nPredown = /etc/wireguard/down" /etc/wireguard/warp.conf
  [ "$m" = 0 ] && sed -i "2i server=2606:4700:4700::1111\nserver=2001:4860:4860::8888\nserver=2001:4860:4860::8844" /etc/dnsmasq.d/warp.conf
  ! grep -q 'warp' /etc/iproute2/rt_tables && echo '250   warp' >>/etc/iproute2/rt_tables
  systemctl disable systemd-resolved --now >/dev/null 2>&1 && sleep 2
  systemctl enable dnsmasq --now >/dev/null 2>&1 && sleep 2
}

# 寻找最佳 MTU
best_mtu() {
  # 反复测试最佳 MTU。 Wireguard Header:IPv4=60 bytes,IPv6=80 bytes，1280 ≤ MTU ≤ 1420。 ping = 8(ICMP回显示请求和回显应答报文格式长度) + 20(IP首部) 。
  # 详细说明:<[WireGuard] Header / MTU sizes for Wireguard>:https://lists.zx2c4.com/pipermail/wireguard/2017-December/002201.html
  # MTU 初始范围（适用于 WireGuard 等封装，IPv4/IPv6 都保守选 1280-1420）
  local MIN_MTU=1280
  local MAX_MTU=1500
  local TEST_IP
  local PING_CMD
  local BEST_MTU=1280

  if [ "$IPV4$IPV6" = "01" ]; then
    TEST_IP="2606:4700:d0::a29f:c001"
    PING_CMD="$PING6"
  else
    TEST_IP="162.159.192.1"
    PING_CMD="ping"
  fi

  # 二分查找能 ping 通的最大 MTU（不碎片）
  while [ $((MIN_MTU <= MAX_MTU)) -eq 1 ]; do
    local MID_MTU=$(( (MIN_MTU + MAX_MTU) / 2 ))
    if $PING_CMD -c1 -W1 -s $MID_MTU -M do "$TEST_IP" >/dev/null 2>&1; then
      BEST_MTU=$MID_MTU
      MIN_MTU=$((MID_MTU + 1))  # 尝试更大值
    else
      MAX_MTU=$((MID_MTU - 1))  # 减小范围
    fi
  done

  # 最终微调确认 BEST_MTU 是最大可用值
  for (( i=BEST_MTU+1; i<=1420; i++ )); do
    if $PING_CMD -c1 -W1 -s $i -M do "$TEST_IP" >/dev/null 2>&1; then
      BEST_MTU=$i
    else
      break
    fi
  done

  # 返回最终 MTU（按需减包头）——可自定义减多少
  # WireGuard：+28 是 IP+UDP，-60 / -80 是安全包头（例如 wireguard + extra overhead）
  grep -q ':' <<< "$TEST_IP" && BEST_MTU=$((BEST_MTU + 28 - 80)) || BEST_MTU=$((BEST_MTU + 28 - 60))

  # 确保范围安全
  [ "$BEST_MTU" -lt 1280 ] && BEST_MTU=1280
  [ "$BEST_MTU" -gt 1420 ] && BEST_MTU=1420

  echo "$BEST_MTU" > /tmp/best_mtu
}

# 寻找最佳 Endpoint，根据 v4 / v6 情况下载 endpoint 库
best_endpoint() {
  # Removed best endpoint feature to adapt to official adjustments
  # Use default endpoint: engage.cloudflareclient.com:2408
  echo "engage.cloudflareclient.com:2408" > /tmp/best_endpoint
}

# WARP 或 WireProxy 安装
install() {

  # 后台下载 wireguard-go 两个版本
  { wget --no-check-certificate $STACK -qO /tmp/wireguard-go-20230223 https://gitlab.com/fscarmen/warp/-/raw/main/wireguard-go/wireguard-go-linux-$ARCHITECTURE-20230223 && chmod +x /tmp/wireguard-go-20230223; }&
  { wget --no-check-certificate $STACK -qO /tmp/wireguard-go-20201118 https://gitlab.com/fscarmen/warp/-/raw/main/wireguard-go/wireguard-go-linux-$ARCHITECTURE-20201118 && chmod +x /tmp/wireguard-go-20201118; }&

  # 根据之前判断的情况，让用户选择使用 wireguard 内核还是 wireguard-go serverd; 若为 wireproxy 方案则跳过此步
  if [ "$IS_PUFFERFFISH" != 'is_pufferffish' ]; then
    case "$KERNEL_ENABLE@$WIREGUARD_GO_ENABLE" in
      0@0 )
        error " $(text 3) "
        ;;
      0@1 )
        KERNEL_OR_WIREGUARD_GO='wireguard-go with reserved' && info "\n $(text 136) "
        ;;
      1@0 )
        KERNEL_OR_WIREGUARD_GO='wireguard kernel' && info "\n $(text 136) "
        ;;
      1@1 )
        hint "\n $(text 137) \n" && reading " $(text 50) " KERNEL_OR_WIREGUARD_GO_CHOOSE
        KERNEL_OR_WIREGUARD_GO='wireguard kernel' && [ "$KERNEL_OR_WIREGUARD_GO_CHOOSE" = 2 ] && KERNEL_OR_WIREGUARD_GO='wireguard-go with reserved'
    esac
  fi

  # Warp 工作模式: 全局或非全局，在 dnsmasq / wireproxy 方案下不选择
  if [[ "$IS_ANEMONE" != 'is_anemone' && "$IS_PUFFERFFISH" != 'is_pufferffish' ]]; then
    [ -z "$GLOBAL_OR_NOT_CHOOSE" ] && hint "\n $(text 139) \n" && reading " $(text 50) " GLOBAL_OR_NOT_CHOOSE
    GLOBAL_OR_NOT="$(text 95)" && [ "$GLOBAL_OR_NOT_CHOOSE" = 2 ] && GLOBAL_OR_NOT="$(text 96)"
  fi

  # WireProxy 禁止重复安装，自定义 Port
  if [ "$IS_PUFFERFFISH" = 'is_pufferffish' ]; then
    ss -nltp | grep -q wireproxy && error " $(text 130) " || input_port

  # iptables 禁止重复安装，不适用于 IPv6 only VPS
  elif [ "$IS_ANEMONE" = 'is_anemone' ]; then
    [ -e /etc/dnsmasq.d/warp.conf ] && error " $(text 131) "
    [ "$m" = 0 ] && error " $(text 112) " || CONF=${CONF1[n]}
  fi

  # CONF 参数如果不是3位或4位， 即检测不出正确的配置参数， 脚本退出
  [[ "$IS_PUFFERFFISH" != 'is_pufferffish' && "${#CONF}" != [34] ]] && error " $(text 135) "

  # 先删除之前安装，可能导致失败的文件
  rm -rf /usr/bin/wireguard-go /etc/wireguard/warp-account.conf

  # 选择优先使用 IPv4 /IPv6 网络
  [ "$IS_PUFFERFFISH" != 'is_pufferffish' ] && hint "\n $(text 74) \n" && reading " $(text 50) " PRIORITY

  # 脚本开始时间
  start=$(date +%s)

  # 如果是 IPv6 only 机器，备份原 dns 文件，再使用 nat64
  [ "$m" = 0 ] && cp -f /etc/resolv.conf{,.origin} && echo -e "nameserver 2a00:1098:2b::1\nnameserver 2a01:4f9:c010:3f02::1\nnameserver 2a01:4f8:c2c:123f::1\nnameserver 2a00:1098:2c::1" > /etc/resolv.conf

  # 注册 WARP 账户 (将生成 warp-account.conf 文件保存账户信息)
  {
    # 如安装 WireProxy ，尽量下载官方的最新版本，如官方 WireProxy 下载不成功，将使用 cdn，以更好的支持双栈和大陆 VPS。并添加执行权限
    if [ "$IS_PUFFERFFISH" = 'is_pufferffish' ]; then
      wireproxy_latest=$(wget --no-check-certificate -qO- -T1 -t1 $STACK "${GH_PROXY}https://api.github.com/repos/pufferffish/wireproxy/releases/latest" | awk -F [v\"] '/tag_name/{print $5; exit}')
      wireproxy_latest=${wireproxy_latest:-'1.0.9'}
      wget --no-check-certificate -T10 -t1 $STACK -O wireproxy.tar.gz ${GH_PROXY}https://github.com/pufferffish/wireproxy/releases/download/v"$wireproxy_latest"/wireproxy_linux_"$ARCHITECTURE".tar.gz ||
      wget --no-check-certificate $STACK -O wireproxy.tar.gz https://gitlab.com/fscarmen/warp/-/raw/main/wireproxy/wireproxy_linux_"$ARCHITECTURE".tar.gz
      [ -x "$(type -p tar)" ] || ${PACKAGE_INSTALL[int]} tar 2>/dev/null || ( ${PACKAGE_UPDATE[int]}; ${PACKAGE_INSTALL[int]} tar 2>/dev/null )
      tar xzf wireproxy.tar.gz -C /usr/bin/; rm -f wireproxy.tar.gz
    fi

    # 注册 WARP 账户 ( warp-account.conf )。
    mkdir -p /etc/wireguard/ >/dev/null 2>&1
    warp_api "register" > /etc/wireguard/warp-account.conf 2>/dev/null

    # 生成 WireGuard 配置文件 (warp.conf)
    if [ -s /etc/wireguard/warp-account.conf ]; then
      cat > /etc/wireguard/warp.conf <<EOF
[Interface]
PrivateKey = $(awk -F'"' '/"private_key"/ {print $4; exit}' /etc/wireguard/warp-account.conf)
Address = 172.16.0.2/32
Address = $(awk -F'"' '/"v6"[[:space:]]*:/ && $4 !~ /^\[/ {print $4; exit}' /etc/wireguard/warp-account.conf)/128
DNS = 8.8.8.8
MTU = 1280
#Reserved = $(awk '/"reserved": \[/{flag=1; printf "["; next} flag && /\]/{printf "]"; flag=0; print ""; next} flag {gsub(/[ \t\n\r]/,""); printf "%s", $0}' /etc/wireguard/warp-account.conf)
#Table = off
#PostUp = /etc/wireguard/NonGlobalUp.sh
#PostDown = /etc/wireguard/NonGlobalDown.sh

[Peer]
PublicKey = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=
AllowedIPs = 0.0.0.0/0
AllowedIPs = ::/0
Endpoint = engage.cloudflareclient.com:2408
EOF
      chmod 600 /etc/wireguard/warp.conf

      cat > /etc/wireguard/NonGlobalUp.sh <<EOF
sleep 5
ip -4 rule add from 172.16.0.2 lookup 51820
ip -4 rule add table main suppress_prefixlength 0
ip -4 route add default dev warp table 51820
ip -6 rule add oif warp lookup 51820
ip -6 rule add table main suppress_prefixlength 0
ip -6 route add default dev warp table 51820
EOF

      cat > /etc/wireguard/NonGlobalDown.sh <<EOF
ip -4 rule delete oif warp lookup 51820
ip -4 rule delete table main suppress_prefixlength 0
ip -6 rule delete oif warp lookup 51820
ip -6 rule delete table main suppress_prefixlength 0
EOF

      chmod +x /etc/wireguard/NonGlobal*.sh
      info "\n $(text 33) \n"
    fi
  }&

  # 对于 IPv4 only VPS 开启 IPv6 支持
  # 感谢 P3terx 大神项目这块的技术指导。项目:https://github.com/P3TERX/warp.sh/blob/main/warp.sh
  {
    [ "$IPV4$IPV6" = 10 ] && [[ $(sysctl -a 2>/dev/null | grep 'disable_ipv6.*=.*1') || $(grep -s "disable_ipv6.*=.*1" /etc/sysctl.{conf,d/*} ) ]] &&
    (sed -i '/disable_ipv6/d' /etc/sysctl.{conf,d/*}
    echo 'net.ipv6.conf.all.disable_ipv6 = 0' >/etc/sysctl.d/ipv6.conf
    sysctl -w net.ipv6.conf.all.disable_ipv6=0)
  }&

  # 后台设置优先使用 IPv4 /IPv6 网络
  { stack_priority; }&

  # 根据系统选择需要安装的依赖
  info "\n $(text 32) \n"

  case "$SYSTEM" in
    Debian )
      local DEBIAN_VERSION=$(echo $SYS | sed "s/[^0-9.]//g" | cut -d. -f1)
      # 添加 backports 源,之后才能安装 wireguard-tools
      if [ "$DEBIAN_VERSION" = '9' ]; then
        echo "deb http://deb.debian.org/debian/ unstable main" > /etc/apt/sources.list.d/unstable-wireguard.list
        echo -e "Package: *\nPin: release a=unstable\nPin-Priority: 150\n" > /etc/apt/preferences.d/limit-unstable
      elif [[ "$DEBIAN_VERSION" =~ ^(10|11)$ ]]; then
        echo "deb http://archive.debian.org/debian $(awk -F '=' '/VERSION_CODENAME/{print $2}' /etc/os-release)-backports main" > /etc/apt/sources.list.d/backports.list
      else
        echo "deb http://deb.debian.org/debian $(awk -F '=' '/VERSION_CODENAME/{print $2}' /etc/os-release)-backports main" > /etc/apt/sources.list.d/backports.list
      fi
      # 获取最新的软件包列表和更新已安装软件包的信息
      ${PACKAGE_UPDATE[int]}

      # 安装一些必要的网络工具包和wireguard-tools (Wire-Guard 配置工具:wg、wg-quick)
      ${PACKAGE_INSTALL[int]} --no-install-recommends net-tools openresolv dnsutils iptables
      [ "$IS_PUFFERFFISH" != 'is_pufferffish' ] && ${PACKAGE_INSTALL[int]} --no-install-recommends wireguard-tools
      ;;

    Ubuntu )
      # Ubuntu 24.04 及以上版本使用 resolvconf，以下版本则使用 openresolv
       [ "$MAJOR_VERSION" -ge 24 ] && RESOLVER_PKG='resolvconf' || RESOLVER_PKG='openresolv'

      # 获取最新的软件包列表和更新已安装软件包的信息
      ${PACKAGE_UPDATE[int]}

      # 安装一些必要的网络工具包和 wireguard-tools (Wire-Guard 配置工具:wg、wg-quick)
      ${PACKAGE_INSTALL[int]} --no-install-recommends net-tools $RESOLVER_PKG dnsutils iptables
      [ "$IS_PUFFERFFISH" != 'is_pufferffish' ] && ${PACKAGE_INSTALL[int]} --no-install-recommends wireguard-tools
      ;;

    CentOS|Fedora )
      # 安装一些必要的网络工具包和wireguard-tools (Wire-Guard 配置工具:wg、wg-quick)
      [ "$SYSTEM" = 'CentOS' ] && ${PACKAGE_INSTALL[int]} epel-release
      ${PACKAGE_INSTALL[int]} net-tools iptables
      [ "$IS_PUFFERFFISH" != 'is_pufferffish' ] && ${PACKAGE_INSTALL[int]} wireguard-tools

      # 升级所有包同时也升级软件和系统内核
      ${PACKAGE_UPDATE[int]}

      # s390x wireguard-tools 安装
      [ "$ARCHITECTURE" = s390x ] && [ ! -x "$(type -p wg)" ] && rpm -i https://mirrors.cloud.tencent.com/epel/8/Everything/s390x/Packages/w/wireguard-tools-1.0.20210914-1.el8.s390x.rpm

      # CentOS Stream 9 需要安装 resolvconf
      [[ "$SYSTEM" = CentOS && "$(expr "$SYS" : '.*\s\([0-9]\{1,\}\)\.*')" = 9 ]] && [ ! -x "$(type -p resolvconf)" ] &&
      wget $STACK -P /usr/sbin ${GH_PROXY}https://github.com/fscarmen/warp/releases/download/resolvconf/resolvconf && chmod +x /usr/sbin/resolvconf
      ;;

    Alpine )
      # 安装一些必要的网络工具包和wireguard-tools (Wire-Guard 配置工具:wg、wg-quick)
      ${PACKAGE_INSTALL[int]} net-tools iproute2 openresolv openrc iptables ip6tables
      [ "$IS_PUFFERFFISH" != 'is_pufferffish' ] && ${PACKAGE_INSTALL[int]} wireguard-tools
      ;;

    Arch )
      # 安装一些必要的网络工具包和wireguard-tools (Wire-Guard 配置工具:wg、wg-quick)
      ${PACKAGE_INSTALL[int]} openresolv
      [ "$IS_PUFFERFFISH" != 'is_pufferffish' ] && ${PACKAGE_INSTALL[int]} wireguard-tools
  esac

  # 在不是 wireproxy 方案的前提下，先判断是否一定要用 wireguard kernel，如果不是，修改 wg-quick 文件，以使用 wireguard-go reserved 版
  if [ "$IS_PUFFERFFISH" != 'is_pufferffish' ]; then
    if [ "$WIREGUARD_GO_ENABLE" = '1' ]; then
      # 则根据 wireguard-tools 版本判断下载 wireguard-go reserved 版本: wg < v1.0.20210223 , wg-go-reserved = v0.0.20201118-reserved; wg >= v1.0.20210223 , wg-go-reserved = v0.0.20230223-reserved
      local WIREGUARD_TOOLS_VERSION=$(wg --version | sed "s#.* v1\.0\.\([0-9]\+\) .*#\1#g")
      [[ "$WIREGUARD_TOOLS_VERSION" < 20210223 ]] && mv /tmp/wireguard-go-20201118 /usr/bin/wireguard-go || mv /tmp/wireguard-go-20230223 /usr/bin/wireguard-go
      rm -f /tmp/wireguard-go-*

      # 为了兼容 Arch 及相关系统，wg-quick 在 set_dns 和 unset_dns 函数中加入 resolvconf -u
      grep -q "Arch" <<< "$SYSTEM" && ! grep -q 'cmd resolvconf -u' /usr/bin/wg-quick && sed -i '/\[\[ \${#DNS\[@\]} -gt 0 \]\] || return 0/a\        cmd resolvconf -u' /usr/bin/wg-quick

      # 如果用户选择使用 wireguard-go reserved 版本，则修改 wg-quick 文件
      cp -f /usr/bin/wg-quick{,.origin}
      if [ "$KERNEL_ENABLE" = '1' ]; then
        mv -f /usr/bin/wg-quick /usr/bin/wg-quick.reserved
        grep -q '^#[[:space:]]*add_if' /usr/bin/wg-quick.reserved || sed -i '/add_if$/ {s/^/# /; N; s/\n/&\twireguard-go "$INTERFACE"\n/}' /usr/bin/wg-quick.reserved
        [ "$KERNEL_OR_WIREGUARD_GO" = 'wireguard-go with reserved' ] && ln -sf /usr/bin/wg-quick.reserved /usr/bin/wg-quick || ln -sf /usr/bin/wg-quick.origin /usr/bin/wg-quick
      else
        grep -q '^#[[:space:]]*add_if' /usr/bin/wg-quick.origin || sed -i '/add_if$/ {s/^/# /; N; s/\n/&\twireguard-go "$INTERFACE"\n/}' /usr/bin/wg-quick.origin
        ln -sf /usr/bin/wg-quick.origin /usr/bin/wg-quick
      fi
    fi
  fi

  wait

  # WARP 配置修改，172.16.0.0/12 这段是用于 Docker 的
  MODIFY014="s/\(DNS[ ]\+=[ ]\+\).*/\12606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844,1.1.1.1,8.8.8.8,8.8.4.4/g;7 s/^/PostUp = ip -6 rule add from $LAN6 lookup main\nPostDown = ip -6 rule delete from $LAN6 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;s/^.*\:\:\/0/#&/g;\$a\PersistentKeepalive = 30"
  MODIFY016="s/\(DNS[ ]\+=[ ]\+\).*/\12606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844,1.1.1.1,8.8.8.8,8.8.4.4/g;7 s/^/PostUp = ip -6 rule add from $LAN6 lookup main\nPostDown = ip -6 rule delete from $LAN6 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;s/^.*0\.\0\/0/#&/g;\$a\PersistentKeepalive = 30"
  MODIFY01D="s/\(DNS[ ]\+=[ ]\+\).*/\12606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844,1.1.1.1,8.8.8.8,8.8.4.4/g;7 s/^/PostUp = ip -6 rule add from $LAN6 lookup main\nPostDown = ip -6 rule delete from $LAN6 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;\$a\PersistentKeepalive = 30"
  MODIFY104="s/\(DNS[ ]\+=[ ]\+\).*/\11.1.1.1,8.8.8.8,8.8.4.4,2606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844/g;7 s/^/PostUp = ip -4 rule add from $LAN4 lookup main\nPostDown = ip -4 rule delete from $LAN4 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;s/^.*\:\:\/0/#&/g;\$a\PersistentKeepalive = 30"
  MODIFY106="s/\(DNS[ ]\+=[ ]\+\).*/\11.1.1.1,8.8.8.8,8.8.4.4,2606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844/g;7 s/^/PostUp = ip -4 rule add from $LAN4 lookup main\nPostDown = ip -4 rule delete from $LAN4 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;s/^.*0\.\0\/0/#&/g;\$a\PersistentKeepalive = 30"
  MODIFY10D="s/\(DNS[ ]\+=[ ]\+\).*/\11.1.1.1,8.8.8.8,8.8.4.4,2606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844/g;7 s/^/PostUp = ip -4 rule add from $LAN4 lookup main\nPostDown = ip -4 rule delete from $LAN4 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;\$a\PersistentKeepalive = 30"
  MODIFY114="s/\(DNS[ ]\+=[ ]\+\).*/\11.1.1.1,8.8.8.8,8.8.4.4,2606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844/g;7 s/^/PostUp = ip -4 rule add from $LAN4 lookup main\nPostDown = ip -4 rule delete from $LAN4 lookup main\nPostUp = ip -6 rule add from $LAN6 lookup main\nPostDown = ip -6 rule delete from $LAN6 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;s/^.*\:\:\/0/#&/g;\$a\PersistentKeepalive = 30"
  MODIFY116="s/\(DNS[ ]\+=[ ]\+\).*/\11.1.1.1,8.8.8.8,8.8.4.4,2606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844/g;7 s/^/PostUp = ip -4 rule add from $LAN4 lookup main\nPostDown = ip -4 rule delete from $LAN4 lookup main\nPostUp = ip -6 rule add from $LAN6 lookup main\nPostDown = ip -6 rule delete from $LAN6 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;s/^.*0\.\0\/0/#&/g;\$a\PersistentKeepalive = 30"
  MODIFY11D="s/\(DNS[ ]\+=[ ]\+\).*/\11.1.1.1,8.8.8.8,8.8.4.4,2606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844/g;7 s/^/PostUp = ip -4 rule add from $LAN4 lookup main\nPostDown = ip -4 rule delete from $LAN4 lookup main\nPostUp = ip -6 rule add from $LAN6 lookup main\nPostDown = ip -6 rule delete from $LAN6 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;\$a\PersistentKeepalive = 30"
  MODIFY11N4="s/\(DNS[ ]\+=[ ]\+\).*/\11.1.1.1,8.8.8.8,8.8.4.4,2606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844/g;7 s/^/PostUp = ip -4 rule add from $LAN4 lookup main\nPostDown = ip -4 rule delete from $LAN4 lookup main\nPostUp = ip -6 rule add from $LAN6 lookup main\nPostDown = ip -6 rule delete from $LAN6 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;s/^.*\:\:\/0/#&/g;\$a\PersistentKeepalive = 30"
  MODIFY11N6="s/\(DNS[ ]\+=[ ]\+\).*/\11.1.1.1,8.8.8.8,8.8.4.4,2606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844/g;7 s/^/PostUp = ip -4 rule add from $LAN4 lookup main\nPostDown = ip -4 rule delete from $LAN4 lookup main\nPostUp = ip -6 rule add from $LAN6 lookup main\nPostDown = ip -6 rule delete from $LAN6 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;s/^.*0\.\0\/0/#&/g;\$a\PersistentKeepalive = 30"
  MODIFY11ND="s/\(DNS[ ]\+=[ ]\+\).*/\11.1.1.1,8.8.8.8,8.8.4.4,2606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844/g;7 s/^/PostUp = ip -4 rule add from $LAN4 lookup main\nPostDown = ip -4 rule delete from $LAN4 lookup main\nPostUp = ip -6 rule add from $LAN6 lookup main\nPostDown = ip -6 rule delete from $LAN6 lookup main\nPostUp = ip -4 rule add from 172.17.0.0\/24 lookup main\nPostDown = ip -4 rule delete from 172.17.0.0\/24 lookup main\n\n/;\$a\PersistentKeepalive = 30"

  # 修改配置文件
  sed -i "$(eval echo "\$MODIFY$CONF")" /etc/wireguard/warp.conf
  [ -e /tmp/best_mtu ] && MTU=$(cat /tmp/best_mtu) && rm -f /tmp/best_mtu && sed -i "s/MTU.*/MTU = $MTU/g" /etc/wireguard/warp.conf

  # 根据选择，处理 warp 是否全局代理
  [ "$GLOBAL_OR_NOT" = "$(text 96)" ] && sed -i "/Table/s/#//g;/NonGlobal/s/#//g" /etc/wireguard/warp.conf
  info "\n $(text 81) \n"

  # 对于 CentOS 9 / AlmaLinux 9 / RockyLinux 9 及类似系统的处理
  if [ "${SYSTEM}_${MAJOR_VERSION}" = 'CentOS_9' ]; then
    centos9_resolv backup
    centos9_resolv generate $m
    sed -i 's/^\(DNS[[:space:]]=.*\)/#\1/' /etc/wireguard/warp.conf
  fi

  if [ "$IS_PUFFERFFISH" = 'is_pufferffish' ]; then
    # 默认 Endpoint 和 DNS 默认 IPv4 和 双栈的，如是 IPv6 修改默认值
    local ENDPOINT=$(awk '/^Endpoint/{print $NF}' /etc/wireguard/warp.conf)
    local MTU=$(awk '/^MTU/{print $NF}' /etc/wireguard/warp.conf)
    local FREE_ADDRESS6=$(awk '/^Address.*128$/{print $NF}' /etc/wireguard/warp.conf)
    local FREE_PRIVATEKEY=$(awk '/PrivateKey/{print $NF}' /etc/wireguard/warp.conf)
    [ "$m" = 0 ] && local DNS='2606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844,1.1.1.1,8.8.8.8,8.8.4.4' || local DNS='1.1.1.1,8.8.8.8,8.8.4.4,2606:4700:4700::1111,2001:4860:4860::8888,2001:4860:4860::8844'

    # 创建 Wireproxy 配置文件
    cat > /etc/wireguard/proxy.conf << EOF
# The [Interface] and [Peer] configurations follow the same semantics and meaning
# of a wg-quick configuration. To understand what these fields mean, please refer to:
# https://wiki.archlinux.org/title/WireGuard#Persistent_configuration
# https://www.wireguard.com/#simple-network-interface
# The subnet should be /32 and /128 for IPv4 and v6 respectively
[Interface]
Address = 172.16.0.2/32, $FREE_ADDRESS6
MTU = $MTU
PrivateKey = $FREE_PRIVATEKEY
DNS = $DNS

[Peer]
PublicKey = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=
# PresharedKey = UItQuvLsyh50ucXHfjF0bbR4IIpVBd74lwKc8uIPXXs= (optional)
Endpoint = $ENDPOINT
# PersistentKeepalive = 25 (optional)

# TCPClientTunnel is a tunnel listening on your machine,
# and it forwards any TCP traffic received to the specified target via wireguard.
# Flow:
# <an app on your LAN> --> localhost:25565 --(wireguard)--> play.cubecraft.net:25565
#[TCPClientTunnel]
#BindAddress = 127.0.0.1:25565
#Target = play.cubecraft.net:25565

# TCPServerTunnel is a tunnel listening on wireguard,
# and it forwards any TCP traffic received to the specified target via local network.
# Flow:
# <an app on your wireguard network> --(wireguard)--> 172.16.31.2:3422 --> localhost:25545
#[TCPServerTunnel]
#ListenPort = 3422
#Target = localhost:25545

# STDIOTunnel is a tunnel connecting the standard input and output of the wireproxy
# process to the specified TCP target via wireguard.
# This is especially useful to use wireproxy as a ProxyCommand parameter in openssh
# For example:
#    ssh -o ProxyCommand='wireproxy -c myconfig.conf' ssh.myserver.net
# Flow:
# Piped command -->(wireguard)--> ssh.myserver.net:22
#[STDIOTunnel]
#Target = ssh.myserver.net:22

# Socks5 creates a socks5 proxy on your LAN, and all traffic would be routed via wireguard.
[Socks5]
BindAddress = 127.0.0.1:$PORT

# Socks5 authentication parameters, specifying username and password enables
# proxy authentication.
#Username = ...
# Avoid using spaces in the password field
#Password = ...

# http creates a http proxy on your LAN, and all traffic would be routed via wireguard.
#[http]
#BindAddress = 127.0.0.1:25345

# HTTP authentication parameters, specifying username and password enables
# proxy authentication.
#Username = ...
# Avoid using spaces in the password field
#Password = ...

# Specifying certificate and key enables HTTPS
#CertFile = ...
#KeyFile = ...

[Resolve]
# Set DNS Resovle Strategy
# \`ipv4\`: Prioritize A records.
# \`ipv6\`: Prioritize AAAA records       .
# \`auto\` (Default): If the WireGuard interface has IPv4 address only, it's equivalent to \`ipv4\`, otherwise it's equivalent to \`ipv6\`.
ResolveStrategy = auto
EOF

    # 创建 WireProxy systemd 进程守护
    if [ "$SYSTEM" = Alpine ]; then
      cat > /etc/init.d/wireproxy << EOF
#!/sbin/openrc-run

description="WireProxy for WARP"
command="/usr/bin/wireproxy"
command_args="-c /etc/wireguard/proxy.conf"
command_background=true
pidfile="/var/run/wireproxy.pid"
EOF
      chmod +x /etc/init.d/wireproxy
    else
      cat > /lib/systemd/system/wireproxy.service << EOF
[Unit]
Description=WireProxy for WARP
After=network.target
Documentation=https://github.com/fscarmen/warp-sh
Documentation=https://github.com/pufferffish/wireproxy

[Service]
ExecStart=/usr/bin/wireproxy -c /etc/wireguard/proxy.conf
RemainAfterExit=yes
Restart=always

[Install]
WantedBy=multi-user.target
EOF
    fi

    # 保存好配置文件
    mv -f $0 /etc/wireguard/menu.sh >/dev/null 2>&1

    # 创建再次执行的软链接快捷方式，再次运行可以用 warp 指令,设置默认语言
    chmod +x /etc/wireguard/menu.sh >/dev/null 2>&1
    ln -sf /etc/wireguard/menu.sh /usr/bin/warp && info " $(text 38) "
    echo "$L" >/etc/wireguard/language

    # 开启 wireproxy
    wireproxy_onoff no_output

    # 设置开机启动 wireproxy
    [ "$SYSTEM" = Alpine ] && rc-update add wireproxy default || systemctl enable --now wireproxy
    sleep 1

    # 结果提示，脚本运行时间，次数统计
    end=$(date +%s)
    info " $(text 114) "
    statistics_of_run-times get
    info " $(text 27): $WIREPROXY_SOCKS5\n WARP$WIREPROXY_ACCOUNT\n IPv4: $WIREPROXY_WAN4 $WIREPROXY_COUNTRY4 $WIREPROXY_ASNORG4\n IPv6: $WIREPROXY_WAN6 $WIREPROXY_COUNTRY6 $WIREPROXY_ASNORG6"
    echo -e "\n==============================================================\n"
    hint " $(text 43) \n" && help

  else
    [ "$IS_ANEMONE" = 'is_anemone' ] && ( iptables_solution; systemctl restart dnsmasq >/dev/null 2>&1 )

    # 创建再次执行的软链接快捷方式，再次运行可以用 warp 指令,设置默认语言
    mv -f $0 /etc/wireguard/menu.sh >/dev/null 2>&1
    chmod +x /etc/wireguard/menu.sh >/dev/null 2>&1
    ln -sf /etc/wireguard/menu.sh /usr/bin/warp && info " $(text 38) "
    echo "$L" >/etc/wireguard/language

    # 自动刷直至成功（ warp bug，有时候获取不了ip地址），重置之前的相关变量值，记录新的 IPv4 和 IPv6 地址和归属地，IPv4 / IPv6 优先级别
    info " $(text 39) "
    unset IP4 IP6 WAN4 WAN6 COUNTRY4 COUNTRY6 ASNORG4 ASNORG6 TRACE4 TRACE6 PLUS4 PLUS6 WARPSTATUS4 WARPSTATUS6
    net no_output

    # 显示 IPv4 / IPv6 优先结果
    result_priority

    # 设置开机启动 warp
    ${SYSTEMCTL_ENABLE[int]} >/dev/null 2>&1

    # 结果提示，脚本运行时间，次数统计
    end=$(date +%s)
    echo -e "\n==============================================================\n"
    info " IPv4: $WAN4 $COUNTRY4  $ASNORG4 "
    info " IPv6: $WAN6 $COUNTRY6  $ASNORG6 "
    info " $(text 28) "
    statistics_of_run-times get
    info " $PRIORITY_NOW , $(text 46) "
    echo -e "\n==============================================================\n"
    hint " $(text 43) \n" && help
    [[ "$TRACE4$TRACE6" = offoff ]] && warning " $(text 44) "
  fi
  }

# 等待进程运行结果函数
wait_for() {
  local WHAT=$1
  local TIME_OUT=0
  local MAX_TIME=30
  until [ "$TIME_OUT" -gt "$MAX_TIME" ]; do
    ((TIME_OUT++))
    case "$WHAT" in
      interface )
        grep -q 'CloudflareWARP' <<< "$(ip link show | awk -F': ' '{print $2}')" && echo "OK" && return
        ;;
      socks5 )
        grep -q 'warp-svc' <<< "$(ss -nltp | awk '{print $NF}' | awk -F \" '{print $2}')" && echo "OK" && return
        ;;
      [0-9]* )
        grep -q ":$WHAT" <<< "$(ss -nltp)" && echo "OK" && return
        ;;
    esac
    sleep 1
  done
  echo "NO"
}

client_install() {
  settings() {
    # 如果是 Warp 模式，进程守护添加 rule_add 和 rule_del
    [ "$IS_LUBAN" = 'is_luban' ] && sed -i '/ExecStart=\/bin\/warp-svc/a\ExecStartPost=warp z\nExecStop=warp x' /usr/lib/systemd/system/warp-svc.service && systemctl daemon-reload

    info " $(text 84) "
    while true; do
      ((REGISTER_ERROR_TIME++))
      warp-cli --accept-tos registration new >/dev/null 2>&1
      local REGISTRATION_SHOW=$(warp-cli --accept-tos registration show 2>/dev/null)
      if [[ "$REGISTRATION_SHOW" =~ "ID:" ]]; then
        break

      # 注册失败，给予一个免费账户。
      elif [[ "$REGISTER_ERROR_TIME" -gt 10 || "$REGISTRATION_SHOW" =~ 'Error: Missing registration' ]]; then
        [ ! -d /var/lib/cloudflare-warp ] && mkdir -p /var/lib/cloudflare-warp
        echo '{"registration_id":"317b5a76-3da1-469f-88d6-c3b261da9f10","api_token":"11111111-1111-1111-1111-111111111111","secret_key":"CNUysnWWJmFGTkqYtg/wpDfURUWvHB8+U1FLlVAIB0Q=","public_key":"DuOi83pAIsbJMP3CJpxq6r3LVGHtqLlzybEIvbczRjo=","override_codes":null}' > /var/lib/cloudflare-warp/reg.json
        echo '{"own_public_key":"DuOi83pAIsbJMP3CJpxq6r3LVGHtqLlzybEIvbczRjo=","registration_id":"317b5a76-3da1-469f-88d6-c3b261da9f10","time_created":{"secs_since_epoch":1692163041,"nanos_since_epoch":81073202},"interface":{"v4":"172.16.0.2","v6":"2606:4700:110:8d4e:cef9:30c2:6d4a:f97b"},"endpoints":[{"v4":"162.159.192.7:2408","v6":"[2606:4700:d0::a29f:c007]:2408"},{"v4":"162.159.192.7:500","v6":"[2606:4700:d0::a29f:c007]:500"},{"v4":"162.159.192.7:1701","v6":"[2606:4700:d0::a29f:c007]:1701"},{"v4":"162.159.192.7:4500","v6":"[2606:4700:d0::a29f:c007]:4500"}],"public_key":"bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=","account":{"account_type":"free","id":"7e0e6c80-24c5-49ba-ba3d-087f45fcd1e9","license":"n01H3Cf4-3Za40C7b-5qOs0c42"},"policy":null,"valid_until":"2023-08-17T05:17:21.081073724Z","alternate_networks":null,"dex_tests":null,"custom_cert_settings":null}' > /var/lib/cloudflare-warp/conf.json
        warp-cli --accept-tos disconnect >/dev/null 2>&1
        warp-cli --accept-tos connect >/dev/null 2>&1
        sleep 1
        [[ $(warp-cli --accept-tos registration show) =~ 'Free' ]] && warning "\n $(text 107) \n"
        break
      else
        sleep 2
      fi
    done

    wait

    # 关闭隧道 qlog logging
    warp-cli --accept-tos debug qlog disable >/dev/null 2>&1

    # 判断安装模式: IS_LUBAN=is_luban 为 warp interface 模式，否则为 socks5 proxy 模式
    if [ "$IS_LUBAN" = 'is_luban' ]; then
      i=1; j=3
      hint " $(text 11)\n $(text 12) "
      warp-cli --accept-tos tunnel ip add-range 0.0.0.0/0 >/dev/null 2>&1
      warp-cli --accept-tos tunnel ip add-range ::0/0 >/dev/null 2>&1
      warp-cli --accept-tos mode warp >/dev/null 2>&1
      warp-cli --accept-tos connect >/dev/null 2>&1
      grep -q 'NO' <<< "$(wait_for interface)" && error " $(text 52) "
      rule_add >/dev/null 2>&1
      ip_case d is_luban
      until [[ -n "$CFWARP_WAN4" && -n "$CFWARP_WAN6" ]]; do
        (( i++ )) || true
        hint " $(text 12) "
        warp-cli --accept-tos disconnect >/dev/null 2>&1
        rule_del >/dev/null 2>&1
        sleep 2
        warp-cli --accept-tos connect >/dev/null 2>&1
        grep -q 'NO' <<< "$(wait_for interface)" && error " $(text 52) "
        rule_add >/dev/null 2>&1
        ip_case d is_luban
        if [ "$i" = "$j" ]; then
          warp-cli --accept-tos disconnect >/dev/null 2>&1
          rule_del >/dev/null 2>&1
          error " $(text 13) "
        fi
      done
      info " $(text 14) "
    else
      warp-cli --accept-tos mode proxy >/dev/null 2>&1
      warp-cli --accept-tos proxy port "$PORT" >/dev/null 2>&1
      warp-cli --accept-tos connect >/dev/null 2>&1
      grep -q 'OK' <<< "$(wait_for socks5)" && info " $(text 86) " || error " $(text 87) "
    fi
  }

  # 禁止安装的情况: 1. 重复安装; 2. 非 AMD64 CPU 架构; 3. 非 Ubuntu / Debian / CentOS 系统
  [ "$CLIENT" -ge 2 ] && error " $(text 85) "
  [[ ! "$ARCHITECTURE" =~ ^(arm64|amd64)$ ]] && error " $(text 101) "
  [[ ! "$SYSTEM" =~ Ubuntu|Debian|CentOS ]] && error " $(text 4) "

  # CentOS 7 及以下的系统安装不了 Client
  [[ "$SYSTEM" = 'CentOS' && "$(expr "$SYS" : '.*\s\([0-9]\{1,\}\)\.*')" -le 7 ]] && error " $(text 102) "

  # 安装 WARP Linux Client
  [ "$IS_LUBAN" != 'is_luban' ] && input_port
  start=$(date +%s)
  mkdir -p /etc/wireguard/ >/dev/null 2>&1
  if [ "$CLIENT" = 0 ]; then
    info " $(text 83) "
    if grep -q "CentOS\|Fedora" <<< "$SYSTEM"; then
      curl -fsSl https://pkg.cloudflareclient.com/cloudflare-warp-ascii.repo | tee /etc/yum.repos.d/cloudflare-warp.repo
    else
      #### 由于 Cloudflare Client 尚未适配 Ubuntu 26.04 (Resolute)，目前暂时回退至 Ubuntu 24.04 (Noble) 继续安装。
      local VERSION_CODENAME=$(awk -F '=' '/VERSION_CODENAME/{print $2}' /etc/os-release | sed 's/resolute/noble/g')
      [ -x "$(type -p gpg)" ] || ${PACKAGE_INSTALL[int]} gnupg 2>/dev/null
      curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
      echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $VERSION_CODENAME main" | tee /etc/apt/sources.list.d/cloudflare-client.list
    fi
    ${PACKAGE_UPDATE[int]}
    ${PACKAGE_INSTALL[int]} cloudflare-warp
    [ "$(systemctl is-active warp-svc)" != active ] && ( systemctl start warp-svc; sleep 2 )

    # warp-cli 只连这个路径,这是一个 AF_UNIX socket
    until [ -e /run/cloudflare-warp/warp_service ]; do
      sleep 2
    done

    settings
  elif [[ "$CLIENT" = '2' && $(warp-cli --accept-tos status 2>/dev/null) =~ 'Registration missing' ]]; then
    [ "$(systemctl is-active warp-svc)" != active ] && ( systemctl start warp-svc; sleep 2 )
    settings
  else
    warning " $(text 85) "
  fi

  # 创建再次执行的软链接快捷方式，再次运行可以用 warp 指令,设置默认语言
  mv -f $0 /etc/wireguard/menu.sh >/dev/null 2>&1
  chmod +x /etc/wireguard/menu.sh >/dev/null 2>&1
  ln -sf /etc/wireguard/menu.sh /usr/bin/warp && info " $(text 38) "
  echo "$L" >/etc/wireguard/language

  # 结果提示，脚本运行时间，次数统计
  local CLIENT_ACCOUNT=$(warp-cli --accept-tos registration show 2>/dev/null | awk  '/type/{print $3}')
  [ "$CLIENT_ACCOUNT" = Limited ] && CLIENT_AC='+'

  if [ "$IS_LUBAN" = 'is_luban' ]; then
    end=$(date +%s)
    echo -e "\n==============================================================\n"

    info " $(text 94) "
    statistics_of_run-times get
    info " WARP$CLIENT_AC IPv4: $CFWARP_WAN4 $CFWARP_COUNTRY4  $CFWARP_ASNORG4\n WARP$CLIENT_AC IPv6: $CFWARP_WAN6 $CFWARP_COUNTRY6  $CFWARP_ASNORG6 "
  else
    ip_case d client
    end=$(date +%s)
    echo -e "\n==============================================================\n"
    info " $(text 94) "
    statistics_of_run-times get
    info " $(text 27): $CLIENT_SOCKS5\n WARP$CLIENT_AC IPv4: $CLIENT_WAN4 $CLIENT_COUNTRY4 $CLIENT_ASNORG4\n WARP$CLIENT_AC IPv6: $CLIENT_WAN6 $CLIENT_COUNTRY6 $CLIENT_ASNORG6 "
  fi

  echo -e "\n==============================================================\n"
  hint " $(text 43) \n" && help
}

# iptables+dnsmasq+ipset 方案，IPv6 only 不适用
stream_solution() {
  [ "$m" = 0 ] && error " $(text 112) "

  echo -e "\n==============================================================\n"
  info " $(text 139) "
  echo -e "\n==============================================================\n"
  hint " 1. $(text 48) "
  [ "$OPTION" != e ] && hint " 0. $(text 49) \n" || hint " 0. $(text 76) \n"
  reading " $(text 50) " IPTABLES
  case "$IPTABLES" in
    1 )
      CONF=${CONF1[n]}; IS_ANEMONE=is_anemone; install
      ;;
    0 )
      [ "$OPTION" != e ] && menu || exit
      ;;
    * )
      warning " $(text 51) [0-1]"; sleep 1; stream_solution
  esac
}

# wireproxy 方案
wireproxy_solution() {
  ss -nltp | grep -q wireproxy && error " $(text 130) "

  echo -e "\n==============================================================\n"
  info " $(text 129) "
  echo -e "\n==============================================================\n"
  hint " 1. $(text 48) "
  [ "$OPTION" != w ] && hint " 0. $(text 49) \n" || hint " 0. $(text 76) \n"
  reading " $(text 50) " WIREPROXY_CHOOSE
  case "$WIREPROXY_CHOOSE" in
    1 )
      IS_PUFFERFFISH=is_pufferffish; install
      ;;
    0 )
      [ "$OPTION" != w ] && menu || exit
      ;;
    * )
      warning " $(text 51) [0-1]"; sleep 1; wireproxy_solution
  esac
}

# 判断当前 WARP 网络接口及 Client 的运行状态，并对应的给菜单和动作赋值
menu_setting() {
  if [[ "$CLIENT" -gt 1 || "$WIREPROXY" -gt 0 ]]; then
    [ "$CLIENT" -lt 3 ] && MENU_OPTION[1]="1.  $(text 88)" || MENU_OPTION[1]="1.  $(text 89)"
    [ "$WIREPROXY" -lt 2 ] && MENU_OPTION[2]="2.  $(text 127)" || MENU_OPTION[2]="2.  $(text 128)"
    MENU_OPTION[3]="3.  $(text 63)"

    ACTION[1]() { client_onoff; }
    ACTION[2]() { wireproxy_onoff; }
    ACTION[3]() { change_port; }

  else
    check_stack
    case "$m" in
      [0-2] )
        MENU_OPTION[1]="1.  $(text 66)"
        MENU_OPTION[2]="2.  $(text 67)"
        MENU_OPTION[3]="3.  $(text 68)"
        ACTION[1]() { CONF=${CONF1[n]}; install; }
        ACTION[2]() { CONF=${CONF2[n]}; install; }
        ACTION[3]() { CONF=${CONF3[n]}; install; }
        ;;
      * )
        MENU_OPTION[1]="1.  $(text 105)"
        MENU_OPTION[2]="2.  $(text 106)"
        ACTION[1]() { stack_switch; }
        ACTION[2]() { stack_switch; }

        # case * 分支只有2个菜单项，后续从第3项开始
        [ -e /etc/dnsmasq.d/warp.conf ] && IPTABLE_INSTALLED="$(text 92)"
        wg show warp >/dev/null 2>&1 && MENU_OPTION[3]="3.  $(text 77)" || MENU_OPTION[3]="3.  $(text 71)"
        if [ -e /etc/wireguard/warp.conf ]; then
          grep -q '#Table' /etc/wireguard/warp.conf && GLOBAL_OR_NOT="$(text 95)" || GLOBAL_OR_NOT="$(text 96)"
        fi

        MENU_OPTION[4]="4.  ${CLIENT_INSTALLED}${CLIENT_NOT_ALLOWED_ARCHITECTURE}$(text 82)"
        MENU_OPTION[5]="5.  $(text 35)"
        MENU_OPTION[6]="6.  $(text 72)"
        MENU_OPTION[7]="7.  $(text 73)"
        MENU_OPTION[8]="8.  $(text 75)"
        MENU_OPTION[9]="9.  $(text 80)"
        MENU_OPTION[10]="10. ${IPTABLE_INSTALLED}$(text 57)"
        MENU_OPTION[11]="11. ${WIREPROXY_INSTALLED}$(text 113)"
        MENU_OPTION[12]="12. ${CLIENT_INSTALLED}${CLIENT_NOT_ALLOWED_ARCHITECTURE}$(text 132)"
        MENU_OPTION[0]="0.  $(text 76)"

        ACTION[3]() { OPTION=o; onoff; }
        ACTION[4]() { client_install; }; ACTION[5]() { change_ip; }; ACTION[6]() { uninstall; }; ACTION[7]() { bbrInstall; }; ACTION[8]() { ver; };
        ACTION[9]() { bash <(curl -sSL https://gitlab.com/fscarmen/warp_unlock/-/raw/main/unlock.sh) -$L; };
        ACTION[10]() { IS_ANEMONE=is_anemone ;install; };
        ACTION[11]() { IS_PUFFERFFISH=is_pufferffish; install; };
        ACTION[12]() { IS_LUBAN=is_luban; client_install; };
        ACTION[0]() { exit; }
        return
    esac
  fi

  [ -e /etc/dnsmasq.d/warp.conf ] && IPTABLE_INSTALLED="$(text 92)"
  wg show warp >/dev/null 2>&1 && MENU_OPTION[4]="4.  $(text 77)" || MENU_OPTION[4]="4.  $(text 71)"
  if [ -e /etc/wireguard/warp.conf ]; then
    grep -q '#Table' /etc/wireguard/warp.conf && GLOBAL_OR_NOT="$(text 95)" || GLOBAL_OR_NOT="$(text 96)"
  fi

  MENU_OPTION[5]="5.  ${CLIENT_INSTALLED}${CLIENT_NOT_ALLOWED_ARCHITECTURE}$(text 82)"
  MENU_OPTION[6]="6.  $(text 35)"
  MENU_OPTION[7]="7.  $(text 72)"
  MENU_OPTION[8]="8.  $(text 73)"
  MENU_OPTION[9]="9.  $(text 75)"
  MENU_OPTION[10]="10. $(text 80)"
  MENU_OPTION[11]="11. ${IPTABLE_INSTALLED}$(text 57)"
  MENU_OPTION[12]="12. ${WIREPROXY_INSTALLED}$(text 113)"
  MENU_OPTION[13]="13. ${CLIENT_INSTALLED}${CLIENT_NOT_ALLOWED_ARCHITECTURE}$(text 132)"
  MENU_OPTION[0]="0.  $(text 76)"

  ACTION[4]() { OPTION=o; onoff; }
  ACTION[5]() { client_install; }; ACTION[6]() { change_ip; }; ACTION[7]() { uninstall; }; ACTION[8]() { bbrInstall; }; ACTION[9]() { ver; };
  ACTION[10]() { bash <(curl -sSL https://gitlab.com/fscarmen/warp_unlock/-/raw/main/unlock.sh) -$L; };
  ACTION[11]() { IS_ANEMONE=is_anemone ;install; };
  ACTION[12]() { IS_PUFFERFFISH=is_pufferffish; install; };
  ACTION[13]() { IS_LUBAN=is_luban; client_install; };
  ACTION[0]() { exit; }
  }

# 显示菜单
menu() {
  clear
  # hint " $(text 16) "
  echo -e "======================================================================================================================\n"
  info " $(text 17):$VERSION\n $(text 18):$(text 1)\n $(text 19):\n\t $(text 20):$SYS\n\t $(text 21):$(uname -r)\n\t $(text 22):$ARCHITECTURE\n\t $(text 23):$VIRT "
  info "\t IPv4: $WAN4 $COUNTRY4  $ASNORG4 "
  info "\t IPv6: $WAN6 $COUNTRY6  $ASNORG6 "
  case "$TRACE4$TRACE6" in
    *plus* )
      info "\t $(text 59)\t $PLUSINFO\n\t $(text 46) "
      ;;
    *on* )
      info "\t $(text 60)\n\t $(text 46) "
  esac
  [ "$PLAN" != 3 ] && info "\t $(text 61) "
  case "$CLIENT" in
    0 )
      info "\t $(text 30) "
      ;;
    1|2 )
      info "\t $(text 31) "
      ;;
    3 )
      info "\t WARP$CLIENT_AC $(text 24)\t $(text 27): $CLIENT_SOCKS5\n\t WARP$CLIENT_AC IPv4: $CLIENT_WAN4 $CLIENT_COUNTRY4 $CLIENT_ASNORG4\n\t WARP$CLIENT_AC IPv6: $CLIENT_WAN6 $CLIENT_COUNTRY6 $CLIENT_ASNORG6 "
      ;;
    5 )
      info "\t WARP$CLIENT_AC $(text 24)\t $(text 58)\n\t WARP$CLIENT_AC IPv4: $CFWARP_WAN4 $CFWARP_COUNTRY4  $CFWARP_ASNORG4\n\t WARP$CLIENT_AC IPv6: $CFWARP_WAN6 $CFWARP_COUNTRY6  $CFWARP_ASNORG6 "
  esac
  case "$WIREPROXY" in
    0 )
      info "\t $(text 125) "
      ;;
    1 )
      info "\t $(text 126) "
      ;;
    2 )
      info "\t WARP$WIREPROXY_ACCOUNT $(text 124)\t $(text 27): $WIREPROXY_SOCKS5\n\t IPv4: $WIREPROXY_WAN4 $WIREPROXY_COUNTRY4 $WIREPROXY_ASNORG4\n\t IPv6: $WIREPROXY_WAN6 $WIREPROXY_COUNTRY6 $WIREPROXY_ASNORG6 "
  esac
   echo -e "\n======================================================================================================================\n"
  for ((h=1; h<${#MENU_OPTION[*]}; h++)); do hint " ${MENU_OPTION[h]} "; done
  hint " ${MENU_OPTION[0]} "
  reading "\n $(text 50) " MENU_CHOOSE

  # 输入必须是数字且少于等于最大可选项
  if [[ $MENU_CHOOSE =~ ^[0-9]{1,2}$ ]] && (( $MENU_CHOOSE >= 0 && $MENU_CHOOSE < ${#MENU_OPTION[*]} )); then
    ACTION[$MENU_CHOOSE]
  else
    warning " $(text 51) [0-$((${#MENU_OPTION[*]}-1))] " && sleep 1 && menu
  fi
}

# 传参选项 OPTION: 1=为 IPv4 或者 IPv6 补全另一栈WARP; 2=安装双栈 WARP; u=卸载 WARP; b=升级内核、开启BBR及DD; o=WARP开关; 其他或空值=菜单界面
[ "$1" != '[option]' ] && OPTION="${1,,}"

# 不同选项的逻辑
case "$OPTION" in
  s )
    [[ "${2,,}" = [46d] ]] && PRIORITY_SWITCH="${2,,}"
    ;;
  i )
    [[ "${2,,}" =~ ^[a-z]{2}$ ]] && EXPECT="${2,,}"
esac

# 主程序运行 1/3
check_cdn
statistics_of_run-times update menu.sh 2>/dev/null
select_language
check_operating_system

# 设置部分后缀 1/3
case "$OPTION" in
  h )
    help; exit 0
    ;;
  z )
    wait_for interface; rule_add; exit 0
    ;;
  x )
    rule_del; exit 0
    ;;
  i )
    change_ip; exit 0
    ;;
  s )
    stack_priority; result_priority; exit 0
esac

# 主程序运行 2/3
check_root

# 设置部分后缀 2/3
case "$OPTION" in
  b )
    bbrInstall; exit 0
    ;;
  u )
    uninstall; exit 0
    ;;
  v )
    ver; exit 0
    ;;
  n )
    net; exit 0
    ;;
  o )
    onoff; exit 0
    ;;
  r )
    client_onoff; exit 0
    ;;
  y )
    wireproxy_onoff; exit 0
esac

# 主程序运行 3/3
# 在卸载模式下不调用check_dependencies
[[ "$OPTION" != "u" ]] && check_dependencies
check_virt $SYSTEM
check_system_info

# 提前准备最佳 MTU
[[ ${CLIENT} = 0 && ${WIREPROXY} = 0 && ! -s /etc/wireguard/warp.conf ]] && { best_mtu; }&

menu_setting

# 设置部分后缀 3/3
case "$OPTION" in
  # 在已运行 Linux Client 前提下，不能安装 WARP IPv4 或者双栈网络接口。如已经运行 WARP ，参数 4,6,d 从原来的安装改为切换
  [46d] )
    if [ -e /etc/wireguard/warp.conf ]; then
      SWITCHCHOOSE="${OPTION^^}"
      stack_switch
    else
      case "$OPTION" in
        4 )
          [[ "$CLIENT" = [35] ]] && error " $(text 110) "
          CONF=${CONF1[n]}
          ;;
        6 )
          CONF=${CONF2[n]}
          ;;
        d )
          [[ "$CLIENT" = [35] ]] && error " $(text 110) "
          CONF=${CONF3[n]}
      esac
      install
    fi
    ;;
  c )
    client_install
    ;;
  l )
    IS_LUBAN=is_luban && client_install
    ;;
  e )
    stream_solution
    ;;
  w )
    wireproxy_solution
    ;;
  k )
    kernel_reserved_switch
    ;;
  g )
    [ ! -e /etc/wireguard/warp.conf ] && ( GLOBAL_OR_NOT_CHOOSE=2 && CONF=${CONF3[n]} && install; true ) || working_mode_switch
    ;;
  * )
    menu
esac