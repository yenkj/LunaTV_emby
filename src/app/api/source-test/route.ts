/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
import { NextRequest, NextResponse } from 'next/server';

import { API_CONFIG, getConfig } from '@/lib/config';
import { getAdminRoleFromRequest } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const role = await getAdminRoleFromRequest(request);
  if (!role) {
    return NextResponse.json({ error: '你没有权限访问源检测功能' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const sourceKey = searchParams.get('source');

  if (!query || !sourceKey) {
    return NextResponse.json(
      { error: '缺少必要参数: q (查询关键词) 和 source (源标识)' },
      { status: 400 }
    );
  }
  // 特殊处理 emby 源（支持多源）
  if (sourceCode === 'emby' || sourceCode.startsWith('emby_')) {
    try {
      const config = await getConfig();

      // 检查是否有启用的 Emby 源
      if (!config.EmbyConfig?.Sources || config.EmbyConfig.Sources.length === 0) {
        throw new Error('Emby 未配置或未启用');
      }

      // 解析 embyKey
      let embyKey: string | undefined;
      if (sourceCode.startsWith('emby_')) {
        embyKey = sourceCode.substring(5); // 'emby_'.length = 5
      }

      // 使用 EmbyManager 获取客户端和配置
      const { embyManager } = await import('@/lib/emby-manager');
      const sources = await embyManager.getEnabledSources();
      const sourceConfig = sources.find(s => s.key === embyKey);
      const sourceName = sourceConfig?.name || 'Emby';

      const client = await embyManager.getClient(embyKey);

      // 获取媒体详情
      const item = await client.getItem(id);

      // 根据类型处理
      if (item.Type === 'Movie') {
        // 电影
        const subtitles = client.getSubtitles(item);

        const result = {
          source: sourceCode, // 保持与请求一致（emby 或 emby_key）
          source_name: sourceName,
          id: item.Id,
          title: item.Name,
          poster: client.getImageUrl(item.Id, 'Primary'),
          year: item.ProductionYear?.toString() || '',
          douban_id: 0,
          desc: item.Overview || '',
          episodes: [await client.getStreamUrl(item.Id)],
          episodes_titles: [item.Name],
          subtitles: subtitles.length > 0 ? [subtitles] : [],
          proxyMode: false,
        };

        return NextResponse.json(result);
      } else if (item.Type === 'Series') {
        // 剧集 - 获取所有季和集
        const seasons = await client.getSeasons(item.Id);
        const allEpisodes: any[] = [];

        for (const season of seasons) {
          const episodes = await client.getEpisodes(item.Id, season.Id);
          allEpisodes.push(...episodes);
        }

        // 按季和集排序
        allEpisodes.sort((a, b) => {
          if (a.ParentIndexNumber !== b.ParentIndexNumber) {
            return (a.ParentIndexNumber || 0) - (b.ParentIndexNumber || 0);
          }
          return (a.IndexNumber || 0) - (b.IndexNumber || 0);
        });

        const result = {
          source: sourceCode, // 保持与请求一致（emby 或 emby_key）
          source_name: sourceName,
          id: item.Id,
          title: item.Name,
          poster: client.getImageUrl(item.Id, 'Primary'),
          year: item.ProductionYear?.toString() || '',
          douban_id: 0,
          desc: item.Overview || '',
          episodes: await Promise.all(allEpisodes.map((ep) => client.getStreamUrl(ep.Id))),
          episodes_titles: allEpisodes.map((ep) => {
            const seasonNum = ep.ParentIndexNumber || 1;
            const episodeNum = ep.IndexNumber || 1;
            return `S${seasonNum.toString().padStart(2, '0')}E${episodeNum.toString().padStart(2, '0')}`;
          }),
          subtitles: allEpisodes.map((ep) => client.getSubtitles(ep)),
          proxyMode: false,
        };

        return NextResponse.json(result);
      } else {
        throw new Error('不支持的媒体类型');
      }
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  // 特殊处理 xiaoya 源
  if (sourceCode === 'xiaoya') {
    try {
      const config = await getConfig();
      const xiaoyaConfig = config.XiaoyaConfig;

      if (
        !xiaoyaConfig ||
        !xiaoyaConfig.Enabled ||
        !xiaoyaConfig.ServerURL
      ) {
        throw new Error('小雅未配置或未启用');
      }

      const { XiaoyaClient } = await import('@/lib/xiaoya.client');
      const { getXiaoyaMetadata, getXiaoyaEpisodes } = await import('@/lib/xiaoya-metadata');
      const { base58Decode, base58Encode } = await import('@/lib/utils');

      const client = new XiaoyaClient(
        xiaoyaConfig.ServerURL,
        xiaoyaConfig.Username,
        xiaoyaConfig.Password,
        xiaoyaConfig.Token
      );

      // 对id进行base58解码得到目录路径
      let decodedDirPath: string;
      try {
        decodedDirPath = base58Decode(id);
        console.log('[xiaoya] 解码目录路径:', decodedDirPath);
      } catch (decodeError) {
        console.error('[xiaoya] Base58解码失败:', decodeError);
        throw new Error('无效的视频ID');
      }

      // 验证解码后的路径
      if (!decodedDirPath || decodedDirPath.trim() === '') {
        throw new Error('解码后的路径为空');
      }

      // 如果有fileName参数，拼接完整文件路径
      let clickedFilePath: string | undefined;
      if (fileName) {
        // 拼接目录路径和文件名
        clickedFilePath = `${decodedDirPath}${decodedDirPath.endsWith('/') ? '' : '/'}${fileName}`;
        console.log('[xiaoya] 用户点击的文件路径:', clickedFilePath);
      }

      // 获取元数据（使用目录路径或点击的文件路径）
      const metadataPath = clickedFilePath || decodedDirPath;
      const metadata = await getXiaoyaMetadata(
        client,
        metadataPath,
        config.SiteConfig.TMDBApiKey,
        config.SiteConfig.TMDBProxy,
        config.SiteConfig.TMDBReverseProxy
      );

      // 获取集数列表（使用目录路径或点击的文件路径）
      const episodes = await getXiaoyaEpisodes(client, metadataPath);

      // 如果有点击的文件路径，找到对应的集数索引
      let clickedFileIndex = -1;
      if (clickedFilePath) {
        clickedFileIndex = episodes.findIndex(ep => ep.path === clickedFilePath);
        console.log('[xiaoya] 文件在集数列表中的索引:', clickedFileIndex);
      }

      const result = {
        source: 'xiaoya',
        source_name: '小雅',
        id: id, // 保持编码后的目录id
        title: metadata.title,
        poster: metadata.poster || '',
        year: metadata.year || '',
        douban_id: 0,
        desc: metadata.plot || '',
        episodes: episodes.map(ep => `/api/xiaoya/play?path=${encodeURIComponent(base58Encode(ep.path))}`),
        episodes_titles: episodes.map(ep => ep.title),
        subtitles: [],
        proxyMode: false,
        // 返回用户点击的文件索引（如果找到的话）
        initialEpisodeIndex: clickedFileIndex >= 0 ? clickedFileIndex : undefined,
        // 返回元数据来源
        metadataSource: metadata.source,
      };

      return NextResponse.json(result);
    } catch (error) {
      console.error('[xiaoya] 获取详情失败:', error);
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  // 特殊处理 openlist 源 - 直接调用 /api/detail
  if (sourceCode === 'openlist') {
    try {
      const config = await getConfig();
      const openListConfig = config.OpenListConfig;

      if (
        !openListConfig ||
        !openListConfig.Enabled ||
        !openListConfig.URL ||
        !openListConfig.Username ||
        !openListConfig.Password
      ) {
        throw new Error('OpenList 未配置或未启用');
      }

      const rootPath = openListConfig.RootPath || '/';

      // 1. 读取 metainfo 获取元数据
      let metaInfo: any = null;
      let folderMeta: any = null;
      try {
        const { getCachedMetaInfo, setCachedMetaInfo } = await import('@/lib/openlist-cache');
        const { db } = await import('@/lib/db');

        metaInfo = getCachedMetaInfo();

        if (!metaInfo) {
          const metainfoJson = await db.getGlobalValue('video.metainfo');
          if (metainfoJson) {
            metaInfo = JSON.parse(metainfoJson);
            setCachedMetaInfo(metaInfo);
          }
        }

        // 使用 key 查找文件夹信息
        folderMeta = metaInfo?.folders?.[id];
        if (!folderMeta) {
          throw new Error('未找到该视频信息');
        }
      } catch (error) {
        throw new Error('读取视频信息失败: ' + (error as Error).message);
      }

      // 使用 folderName 构建实际路径
      const folderName = folderMeta.folderName;
      const folderPath = `${rootPath}${rootPath.endsWith('/') ? '' : '/'}${folderName}`;

      // 2. 直接调用 OpenList 客户端获取视频列表
      const { OpenListClient } = await import('@/lib/openlist.client');
      const { getCachedVideoInfo, setCachedVideoInfo } = await import('@/lib/openlist-cache');
      const { parseVideoFileName } = await import('@/lib/video-parser');

      const client = new OpenListClient(
        openListConfig.URL,
        openListConfig.Username,
        openListConfig.Password
      );

      let videoInfo = getCachedVideoInfo(folderPath);

      // 获取所有分页的视频文件
      const allFiles: any[] = [];
      let currentPage = 1;
      const pageSize = 100;
      let total = 0;

      while (true) {
        const listResponse = await client.listDirectory(folderPath, currentPage, pageSize);

        if (listResponse.code !== 200) {
          throw new Error('OpenList 列表获取失败4');
        }

        total = listResponse.data.total;
        allFiles.push(...listResponse.data.content);

        if (allFiles.length >= total) {
          break;
        }

        currentPage++;
      }

      const videoExtensions = ['.mp4', '.mkv', '.avi', '.m3u8', '.flv', '.ts', '.mov', '.wmv', '.webm', '.rmvb', '.rm', '.mpg', '.mpeg', '.3gp', '.f4v', '.m4v', '.vob'];
      const videoFiles = allFiles.filter((item) => {
        if (item.is_dir || item.name.startsWith('.') || item.name.endsWith('.json')) return false;
        return videoExtensions.some(ext => item.name.toLowerCase().endsWith(ext));
      });

      if (!videoInfo) {
        videoInfo = { episodes: {}, last_updated: Date.now() };
        videoFiles.sort((a, b) => a.name.localeCompare(b.name));
        for (let i = 0; i < videoFiles.length; i++) {
          const file = videoFiles[i];
          const parsed = parseVideoFileName(file.name);
          videoInfo.episodes[file.name] = {
            episode: parsed.episode || (i + 1),
            season: parsed.season,
            title: parsed.title,
            parsed_from: 'filename',
            isOVA: parsed.isOVA,
          };
        }
        setCachedVideoInfo(folderPath, videoInfo);
      }

      const episodes = videoFiles
        .map((file, index) => {
          const parsed = parseVideoFileName(file.name);
          let episodeInfo;
          if (parsed.episode) {
            episodeInfo = { episode: parsed.episode, season: parsed.season, title: parsed.title, parsed_from: 'filename', isOVA: parsed.isOVA };
          } else {
            episodeInfo = videoInfo!.episodes[file.name] || { episode: index + 1, season: undefined, title: undefined, parsed_from: 'filename' };
          }
          let displayTitle = episodeInfo.title;
          if (!displayTitle && episodeInfo.episode) {
            displayTitle = episodeInfo.isOVA ? `OVA ${episodeInfo.episode}` : `第${episodeInfo.episode}集`;
          }
          if (!displayTitle) {
            displayTitle = file.name;
          }
          return { fileName: file.name, episode: episodeInfo.episode || 0, season: episodeInfo.season, title: displayTitle, isOVA: episodeInfo.isOVA };
        })
        .sort((a, b) => {
          // OVA 排在最后
          if (a.isOVA && !b.isOVA) return 1;
          if (!a.isOVA && b.isOVA) return -1;
          // 都是 OVA 或都不是 OVA，按集数排序
          return a.episode !== b.episode ? a.episode - b.episode : a.fileName.localeCompare(b.fileName);
        });

      // 3. 从 metainfo 中获取元数据
      const { getTMDBImageUrl } = await import('@/lib/tmdb.search');

      const result = {
        source: 'openlist',
        source_name: '私人影库',
        id: id,
        title: folderMeta?.title || folderName,
        poster: folderMeta?.poster_path ? getTMDBImageUrl(folderMeta.poster_path) : '',
        year: folderMeta?.release_date ? folderMeta.release_date.split('-')[0] : '',
        douban_id: 0,
        desc: folderMeta?.overview || '',
        episodes: episodes.map((ep) => `/api/openlist/play?folder=${encodeURIComponent(folderName)}&fileName=${encodeURIComponent(ep.fileName)}`),
        episodes_titles: episodes.map((ep) => ep.title),
        proxyMode: false, // openlist 源不使用代理模式
      };

      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }
  
  try {
    // 🔑 使用 getAvailableApiSites() 获取源列表，自动应用代理配置
    // 注意：source-test 需要测试所有源（包括禁用的），所以直接用 getConfig
    const config = await getConfig();

    // 先从原始配置查找源（支持测试禁用的源）
    const sourceFromConfig = config.SourceConfig.find(
      (s: any) => s.key === sourceKey
    );

    if (!sourceFromConfig) {
      return NextResponse.json(
        { error: `未找到源: ${sourceKey}` },
        { status: 404 }
      );
    }

    // 🔑 应用视频代理配置到单个源
    let targetSource = sourceFromConfig;
    const proxyConfig = config.VideoProxyConfig;

    if (proxyConfig?.enabled && proxyConfig.proxyUrl) {
      const proxyBaseUrl = proxyConfig.proxyUrl.replace(/\/$/, '');
      let realApiUrl = sourceFromConfig.api;

      // 提取真实 API URL（移除旧代理）
      const urlMatch = realApiUrl.match(/[?&]url=([^&]+)/);
      if (urlMatch) {
        realApiUrl = decodeURIComponent(urlMatch[1]);
      }

      // 提取 source ID
      const extractSourceId = (apiUrl: string): string => {
        try {
          const url = new URL(apiUrl);
          const hostname = url.hostname;
          const parts = hostname.split('.');

          if (parts.length >= 3 && (parts[0] === 'caiji' || parts[0] === 'api' || parts[0] === 'cj' || parts[0] === 'www')) {
            return parts[parts.length - 2].toLowerCase().replace(/[^a-z0-9]/g, '');
          }

          let name = parts[0].toLowerCase();
          name = name.replace(/zyapi$/, '').replace(/zy$/, '').replace(/api$/, '');
          return name.replace(/[^a-z0-9]/g, '') || 'source';
        } catch {
          return sourceFromConfig.key || sourceFromConfig.name.replace(/[^a-z0-9]/g, '');
        }
      };

      const sourceId = extractSourceId(realApiUrl);
      const proxiedApi = `${proxyBaseUrl}/p/${sourceId}?url=${encodeURIComponent(realApiUrl)}`;

      targetSource = {
        ...sourceFromConfig,
        api: proxiedApi,
      };

      console.log(`[Source Test] Applied proxy to ${sourceFromConfig.name}`);
    }

    // 构建搜索URL（使用 videolist 更符合多数源的搜索接口）
    const searchUrl = `${targetSource.api}?ac=videolist&wd=${encodeURIComponent(query)}`;

    // 直接请求源接口，不使用缓存
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时

    try {
      const startedAt = Date.now();
      const response = await fetch(searchUrl, {
        headers: API_CONFIG.search.headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return NextResponse.json(
          {
            error: `源接口返回错误: HTTP ${response.status}`,
            sourceError: `${response.status} ${response.statusText}`,
            sourceUrl: searchUrl,
          },
          { status: response.status }
        );
      }

      const data = await response.json();

      // 检查接口返回的数据格式
      if (!data || typeof data !== 'object') {
        return NextResponse.json(
          {
            error: '源接口返回数据格式错误',
            sourceError: '返回数据不是有效的JSON对象',
            sourceUrl: searchUrl,
          },
          { status: 502 }
        );
      }

      // 检查是否有错误信息
      if (data.code && data.code !== 1) {
        return NextResponse.json(
          {
            error: `源接口返回错误: ${data.msg || '未知错误'}`,
            sourceError: data.msg || `错误代码: ${data.code}`,
            sourceUrl: searchUrl,
          },
          { status: 502 }
        );
      }

      // 提取搜索结果
      const results = data.list || data.data || [];

      // 质量与性能指标
      const durationMs = Date.now() - startedAt;
      const resultCount = Array.isArray(results) ? results.length : 0;
      const lowerQ = (query || '').toLowerCase();
      const matched = Array.isArray(results)
        ? results.filter((item: any) =>
            String(item.vod_name || item.title || '')
              .toLowerCase()
              .includes(lowerQ)
          )
        : [];
      const matchRate = resultCount > 0 ? matched.length / resultCount : 0;
      const topMatches = matched
        .slice(0, 3)
        .map((it: any) => it.vod_name || it.title || '');

      return NextResponse.json({
        success: true,
        source: sourceKey,
        sourceName: targetSource.name || sourceKey,
        sourceUrl: searchUrl,
        results: results,
        total: resultCount,
        disabled: targetSource.disabled || false,
        // 新增：性能/质量指标
        durationMs,
        resultCount,
        matchRate,
        topMatches,
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);

      if (fetchError.name === 'AbortError') {
        return NextResponse.json(
          {
            error: '请求超时 (15秒)',
            sourceError: '连接超时',
            sourceUrl: searchUrl,
          },
          { status: 408 }
        );
      }

      return NextResponse.json(
        {
          error: `网络请求失败: ${fetchError.message}`,
          sourceError: fetchError.message,
          sourceUrl: searchUrl,
        },
        { status: 502 }
      );
    }
  } catch (error: any) {
    console.error('源测试API错误:', error);
    return NextResponse.json(
      {
        error: `服务器内部错误: ${error.message}`,
        sourceError: error.message,
      },
      { status: 500 }
    );
  }
}
