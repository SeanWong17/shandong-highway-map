# 来源与许可

原创代码与说明采用 [MIT](LICENSE)。数据和第三方服务按各自许可使用，MIT 不覆盖它们。

| 内容 | 来源与许可 |
| --- | --- |
| 道路几何、OSM 属性及其衍生道路数据库 | © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)；派生数据库按 ODbL 提供 |
| Leaflet 1.9.4（保存在 `vendor/leaflet/`） | [BSD-2-Clause](vendor/leaflet/LICENSE) |
| 省界与 16 个地市界 | [阿里云 DataV 山东省下辖行政区 GeoJSON](https://geo.datav.aliyun.com/areas_v3/bound/370000_full.json)；近似 GCJ-02 → WGS84 转换，省界由地市多边形合并。仅作地图定位背景，不是法定界线成果；独立再分发许可尚未确认 |
| 简洁底图 `assets/street.jpg` | [Natural Earth](https://www.naturalearthdata.com/) 10m 陆地、海岸、河流、湖泊数据自行绘制；公共领域 |
| 地形底图 `assets/terrain.jpg` | [AWS Terrain Tiles / Mapzen / Tilezen](https://registry.opendata.aws/terrain-tiles/) Terrarium 高程数据自行着色与生成山体阴影；高程来源署名包括 USGS SRTM、GMTED2010、NOAA ETOPO1 |
| 项目公告、新闻、论文短引句 | 归原来源所有；保留原链接与引句，未将引用内容重新授权为 MIT |

初始资料来自 `shandong_highway_map` 的 2026-09-30 核对记录。道路源为 [OSM France 山东提取](https://download.openstreetmap.fr/extracts/asia/china/shandong.osm.pbf)，快照时间 2026-09-29T00:48:31Z；原 PBF 提供方 MD5 为 `e540a5452bcdd34e6b6558faf65c9a25`。维护版本以 `data/config.json` 为准。

此轻量项目保留全部 24,939 条短线、原车道判断和不同来源的引句；道路坐标四舍五入至小数点后六位，不合并短线、不降低曲线点数。去掉重复引句、原文件哈希和历史研究台账。道路按 ODbL 分发；公告、引句和原创说明各遵守原权利范围。

两张本地底图按 Web Mercator 配准，省界、地市界与道路使用 WGS84 坐标，Leaflet 负责投影。DataV 边界的坐标转换仅用于显示配准；更换其他 GCJ-02 服务时须重新检查坐标与许可。
