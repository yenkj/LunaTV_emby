import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import {
  getTMDBImageUrl,
  getTMDBMovieRecommendations,
  getTMDBTVRecommendations,
  searchTMDBMulti,
} from '@/lib/tmdb.client';

const searchCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function removeSeasonInfo(title: string): string {
  return title
    .replace(/第[一二三四五六七八九十\d]+[（(]\d+[）)][季部]/g, '')
    .replace(/第[一二三四五六七八九十\d]+[季部]/g, '')
    .replace(/[（(]\d+[）)]/g, '')
    .replace(/\s+season\s+\d+/gi, '')
    .replace(/\s+S\d+/gi, '')
    .trim();
}

function findExactMatch(results: any[], originalTitle: string): any | null {
  if (!results || results.length === 0) return null;

  if (results.length === 1) return results[0];

  const cleanedTitle = removeSeasonInfo(originalTitle).toLowerCase();

  for (const result of results) {
    const resultTitle = (result.title || result.name || '').toLowerCase();
    const resultOriginalTitle = (result.original_title || result.original_name || '').toLowerCase();

    if (resultTitle === cleanedTitle || resultOriginalTitle === cleanedTitle) {
      return result;
    }
  }

  return results[0];
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const title = searchParams.get('title');
    const cachedId = searchParams.get('cachedId');

    if (!title && !cachedId) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { error: 'TMDB API Key 未配置' },
        { status: 500 }
      );
    }

    let tmdbId: number;
    let mediaType: 'movie' | 'tv';

    if (cachedId) {
      const [type, id] = cachedId.split(':');
      mediaType = type as 'movie' | 'tv';
      tmdbId = parseInt(id);
    } else {
      const cleanedTitle = removeSeasonInfo(title!);
      const cacheKey = `search:${cleanedTitle}`;

      const cached = searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        tmdbId = cached.data.tmdbId;
        mediaType = cached.data.mediaType;
      } else {
        const searchResult = await searchTMDBMulti(tmdbApiKey, cleanedTitle);

        if (searchResult.code !== 200 || !searchResult.results.length) {
          return NextResponse.json(
            { recommendations: [], tmdbId: null, mediaType: null },
            {
              status: 200,
              headers: {
                'Cache-Control': 'public, max-age=86400',
              },
            }
          );
        }

        const validResults = searchResult.results.filter(
          (r: any) => r.media_type === 'movie' || r.media_type === 'tv'
        );

        const matched = findExactMatch(validResults, title!);

        if (!matched) {
          return NextResponse.json(
            { recommendations: [], tmdbId: null, mediaType: null },
            {
              status: 200,
              headers: {
                'Cache-Control': 'public, max-age=86400',
              },
            }
          );
        }

        tmdbId = matched.id;
        mediaType = matched.media_type;

        searchCache.set(cacheKey, {
          data: { tmdbId, mediaType },
          timestamp: Date.now(),
        });

        Array.from(searchCache.entries()).forEach(([key, value]) => {
          if (Date.now() - value.timestamp > CACHE_TTL) {
            searchCache.delete(key);
          }
        });
      }
    }

    const recommendationsResult =
      mediaType === 'movie'
        ? await getTMDBMovieRecommendations(tmdbApiKey, tmdbId)
        : await getTMDBTVRecommendations(tmdbApiKey, tmdbId);

    if (recommendationsResult.code !== 200) {
      return NextResponse.json(
        { recommendations: [], tmdbId: `${mediaType}:${tmdbId}`, mediaType },
        {
          status: 200,
          headers: {
            'Cache-Control': 'public, max-age=86400',
          },
        }
      );
    }

    const recommendations = (recommendationsResult.results as any[])
      .filter((r: any) => r.poster_path)
      .slice(0, 20)
      .map((r: any) => ({
        tmdbId: r.id,
        title: r.title || r.name,
        poster: getTMDBImageUrl(r.poster_path, 'w342'),
        rating: r.vote_average ? r.vote_average.toFixed(1) : '',
        mediaType,
      }));

    return NextResponse.json(
      {
        recommendations,
        tmdbId: `${mediaType}:${tmdbId}`,
        mediaType,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=86400',
        },
      }
    );
  } catch (error) {
    console.error('获取 TMDB 推荐失败:', error);
    return NextResponse.json(
      { error: '获取推荐失败' },
      { status: 500 }
    );
  }
}
