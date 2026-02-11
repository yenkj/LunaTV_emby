/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import { ArrowDownWideNarrow, ArrowUpNarrowWide, Film } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

type LibrarySourceType = 'emby' | `emby:${string}` | `emby_${string}`;

interface EmbySourceOption {
  key: string;
  name: string;
}

interface Video {
  id: string;
  folder?: string;
  tmdbId?: number;
  title: string;
  poster: string;
  releaseDate?: string;
  year?: string;
  overview?: string;
  voteAverage?: number;
  rating?: number;
  mediaType: 'movie' | 'tv';
}

interface EmbyView {
  id: string;
  name: string;
  type: string;
}

export default function PrivateLibraryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 获取运行时配置
  const runtimeConfig = useMemo(() => {
    if (typeof window !== 'undefined' && (window as any).RUNTIME_CONFIG) {
      return (window as any).RUNTIME_CONFIG;
    }
    return { EMBY_ENABLED: false };
  }, []);

  // 解析URL中的source参数（支持 emby:emby1 格式）
  const parseSourceParam = (sourceParam: string | null): { sourceType: LibrarySourceType; embyKey?: string } => {
    if (!sourceParam) return { sourceType: 'emby' };

    if (sourceParam.includes(':')) {
      const [type, key] = sourceParam.split(':');
      return { sourceType: type as LibrarySourceType, embyKey: key };
    }

    return { sourceType: sourceParam as LibrarySourceType };
  };

  const [sourceType, setSourceType] = useState<LibrarySourceType>('emby');
  const [embyKey, setEmbyKey] = useState<string | undefined>();
  const [embySourceOptions, setEmbySourceOptions] = useState<EmbySourceOption[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [embyViews, setEmbyViews] = useState<EmbyView[]>([]);
  const [selectedView, setSelectedView] = useState<string>('all');
  const [loadingViews, setLoadingViews] = useState(false);
  // Emby排序状态
  const [sortBy, setSortBy] = useState<string>('SortName');
  const [sortOrder, setSortOrder] = useState<'Ascending' | 'Descending'>('Ascending');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [sortDropdownPosition, setSortDropdownPosition] = useState<{ x: number; y: number; width: number }>({ x: 0, y: 0, width: 0 });
  const sortButtonRef = useRef<HTMLDivElement | null>(null);
  const sortDropdownRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const pageSize = 20;
  const observerTarget = useRef<HTMLDivElement>(null);
  const isFetchingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const embyScrollContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const isInitializedRef = useRef(false);
  const hasRestoredViewRef = useRef(false);

  // 客户端挂载标记
  useEffect(() => {
    setMounted(true);
  }, []);

  // 从URL初始化状态，并检查配置自动跳转
  useEffect(() => {
    const urlSourceParam = searchParams.get('source');

    // 解析source参数
    const parsed = parseSourceParam(urlSourceParam);

    // 如果 URL 中有 source 参数，使用它
    if (parsed.sourceType) {
      setSourceType(parsed.sourceType);
      if (parsed.embyKey) {
        setEmbyKey(parsed.embyKey);
      }
    } else {
      // 默认使用 emby
      setSourceType('emby');
    }

    isInitializedRef.current = true;
  }, [searchParams]);

  // 获取Emby源列表
  useEffect(() => {
    const fetchEmbySources = async () => {
      try {
        const response = await fetch('/api/emby/sources');
        if (response.ok) {
          const data = await response.json();
          setEmbySourceOptions(data.sources || []);

          // 如果没有设置embyKey，使用第一个源
          if (!embyKey && data.sources && data.sources.length > 0) {
            setEmbyKey(data.sources[0].key);
          }
        }
      } catch (error) {
        console.error('获取Emby源列表失败:', error);
      }
    };

    if (sourceType === 'emby') {
      fetchEmbySources();
    }
  }, [sourceType]);

  // 更新URL参数
  useEffect(() => {
    if (!isInitializedRef.current) return;

    const params = new URLSearchParams();

    // 构建source参数
    if (sourceType === 'emby' && embyKey && embySourceOptions.length > 1) {
      params.set('source', `emby:${embyKey}`);
    } else {
      params.set('source', sourceType);
    }

    if (sourceType === 'emby' && selectedView !== 'all') {
      params.set('view', selectedView);
    }

    router.replace(`/private-library?${params.toString()}`, { scroll: false });
  }, [sourceType, embyKey, selectedView, router, embySourceOptions.length]);

  // 切换源类型时重置所有状态（但不在初始化时执行）
  useEffect(() => {
    if (!isInitializedRef.current) return;

    setPage(1);
    setVideos([]);
    setHasMore(true);
    setError('');
    setSelectedView('all');
    setLoading(false);
    setLoadingMore(false);
    isFetchingRef.current = false;
  }, [sourceType, embyKey]);

  // 切换分类时重置状态（但不在初始化时执行）
  useEffect(() => {
    if (!isInitializedRef.current) return;

    setPage(1);
    setVideos([]);
    setHasMore(true);
    setError('');
    setLoading(false);
    setLoadingMore(false);
    isFetchingRef.current = false;
  }, [selectedView]);

  // 切换排序时重置状态（但不在初始化时执行）
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (sourceType !== 'emby') return;

    setPage(1);
    setVideos([]);
    setHasMore(true);
    setError('');
    setLoading(false);
    setLoadingMore(false);
    isFetchingRef.current = false;
  }, [sortBy, sortOrder, sourceType]);

  // 获取 Emby 媒体库列表
  useEffect(() => {
    if (sourceType !== 'emby' || !embyKey) return;

    const fetchEmbyViews = async () => {
      setLoadingViews(true);
      try {
        const params = new URLSearchParams({ embyKey });
        const response = await fetch(`/api/emby/views?${params.toString()}`);
        const data = await response.json();

        if (data.error) {
          console.error('获取 Emby 媒体库列表失败:', data.error);
          setEmbyViews([]);
        } else {
          setEmbyViews(data.views || []);

          // 分类加载完成后，检查URL中是否有view参数（只在第一次加载时恢复）
          if (!hasRestoredViewRef.current) {
            const urlView = searchParams.get('view');
            if (urlView && data.views && data.views.length > 0) {
              // 检查该view是否存在于分类列表中
              const viewExists = data.views.some((v: EmbyView) => v.id === urlView);
              if (viewExists) {
                setSelectedView(urlView);
              }
            }
            hasRestoredViewRef.current = true;
          }
        }
      } catch (err) {
        console.error('获取 Emby 媒体库列表失败:', err);
        setEmbyViews([]);
      } finally {
        setLoadingViews(false);
      }
    };

    fetchEmbyViews();
  }, [sourceType, embyKey]);

  // 鼠标拖动滚动
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrollContainerRef.current) return;
    isDraggingRef.current = true;
    startXRef.current = e.pageX - scrollContainerRef.current.offsetLeft;
    scrollLeftRef.current = scrollContainerRef.current.scrollLeft;
    scrollContainerRef.current.style.cursor = 'grabbing';
    scrollContainerRef.current.style.userSelect = 'none';
  };

  const handleMouseLeave = () => {
    if (!scrollContainerRef.current) return;
    isDraggingRef.current = false;
    scrollContainerRef.current.style.cursor = 'grab';
    scrollContainerRef.current.style.userSelect = 'auto';
  };

  const handleMouseUp = () => {
    if (!scrollContainerRef.current) return;
    isDraggingRef.current = false;
    scrollContainerRef.current.style.cursor = 'grab';
    scrollContainerRef.current.style.userSelect = 'auto';
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 2; // 滚动速度倍数
    scrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
  };

  // 排序相关函数
  const sortOptions = [
    { label: '名称', value: 'SortName' },
    { label: '加入时间', value: 'DateCreated' },
    { label: '发行日期', value: 'PremiereDate' },
    { label: '年份', value: 'ProductionYear' },
    { label: '评分', value: 'CommunityRating' },
  ];

  const getSortDisplayText = () => {
    const option = sortOptions.find((opt) => opt.value === sortBy);
    return option?.label || '排序';
  };

  const isDefaultSort = () => {
    return sortBy === 'SortName' && sortOrder === 'Ascending';
  };

  const calculateSortDropdownPosition = () => {
    const element = sortButtonRef.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const isMobile = viewportWidth < 768;

      let x = rect.left;
      const minWidth = 200;
      let dropdownWidth = Math.max(rect.width, minWidth);
      let useFixedWidth = false;

      if (isMobile) {
        const padding = 16;
        const maxWidth = viewportWidth - padding * 2;
        dropdownWidth = Math.min(dropdownWidth, maxWidth);
        useFixedWidth = true;

        if (x + dropdownWidth > viewportWidth - padding) {
          x = viewportWidth - dropdownWidth - padding;
        }
        if (x < padding) {
          x = padding;
        }
      }

      setSortDropdownPosition({ x, y: rect.bottom + 4, width: useFixedWidth ? dropdownWidth : rect.width });
    }
  };

  const handleSortButtonClick = () => {
    if (showSortDropdown) {
      setShowSortDropdown(false);
    } else {
      setShowSortDropdown(true);
      calculateSortDropdownPosition();
    }
  };

  const handleSortOptionSelect = (value: string) => {
    setSortBy(value);
    setShowSortDropdown(false);
  };

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === 'Ascending' ? 'Descending' : 'Ascending');
  };

  // 点击外部关闭排序下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target as Node) &&
        sortButtonRef.current &&
        !sortButtonRef.current.contains(event.target as Node)
      ) {
        setShowSortDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 滚动时关闭排序下拉框
  useEffect(() => {
    const handleScroll = () => {
      if (showSortDropdown) {
        setShowSortDropdown(false);
      }
    };
    document.body.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, [showSortDropdown]);

  // 加载数据的函数
  useEffect(() => {
    const fetchVideos = async () => {
      const isInitial = page === 1;

      // 取消之前的请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // 如果选择了 emby 但未配置或没有embyKey，不发起请求
      if (sourceType === 'emby' && (!runtimeConfig.EMBY_ENABLED || !embyKey)) {
        setLoading(false);
        return;
      }

      // 创建新的 AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      isFetchingRef.current = true;

      try {
        if (isInitial) {
          setLoading(true);
        } else {
          setLoadingMore(true);
        }
        setError('');

        const endpoint = `/api/emby/list?page=${page}&pageSize=${pageSize}${selectedView !== 'all' ? `&parentId=${selectedView}` : ''}&embyKey=${embyKey}&sortBy=${sortBy}&sortOrder=${sortOrder}`;

        const response = await fetch(endpoint, { signal: abortController.signal });

        if (!response.ok) {
          throw new Error('获取视频列表失败');
        }

        const data = await response.json();

        if (data.error) {
          setError(data.error);
          if (isInitial) {
            setVideos([]);
          }
        } else {
          const newVideos = data.list || [];

          if (isInitial) {
            setVideos(newVideos);
          } else {
            setVideos((prev) => [...prev, ...newVideos]);
          }

          // 检查是否还有更多数据
          const currentPage = data.page || page;
          const totalPages = data.totalPages || 1;
          const hasMoreData = currentPage < totalPages;
          setHasMore(hasMoreData);
        }
      } catch (err: any) {
        // 忽略取消请求的错误
        if (err.name === 'AbortError') {
          return;
        }
        console.error('获取视频列表失败:', err);
        setError('获取视频列表失败');
        if (isInitial) {
          setVideos([]);
        }
      } finally {
        // 只有当这个请求没有被取消时才更新状态
        if (!abortController.signal.aborted) {
          if (isInitial) {
            setLoading(false);
          } else {
            setLoadingMore(false);
          }
          isFetchingRef.current = false;
        }
      }
    };

    fetchVideos();

    // 清理函数：组件卸载时取消请求
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [sourceType, embyKey, page, selectedView, runtimeConfig, sortBy, sortOrder]);

  const handleVideoClick = (video: Video) => {
    // 构建source参数
    let sourceParam = sourceType;
    if (sourceType === 'emby' && embyKey && embySourceOptions.length > 1) {
      sourceParam = `emby:${embyKey}`;
    }

    // 跳转到播放页面
    router.push(`/play?source=${sourceParam}&id=${encodeURIComponent(video.id)}`);
  };

  // 使用 Intersection Observer 监听滚动
  useEffect(() => {
    if (!observerTarget.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        // 当目标元素可见且还有更多数据且没有正在加载时，加载下一页
        if (entry.isIntersecting && hasMore && !loadingMore && !loading && !isFetchingRef.current) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    const currentTarget = observerTarget.current;
    observer.observe(currentTarget);

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, loadingMore, loading, page]);

  return (
    <PageLayout activePath='/private-library'>
      <div className='container mx-auto px-4 py-6'>
        <div className='mb-6 flex justify-between items-start'>
          <div>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              私人影库
            </h1>
            <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
              观看自我收藏的高清视频吧
            </p>
          </div>
          {mounted && (
            <button
              onClick={() => router.push('/movie-request')}
              className='flex items-center gap-2 px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors'
            >
              <Film size={20} />
              <span>求片</span>
            </button>
          )}
        </div>

        {/* 第一级：源类型选择（仅 Emby） */}
        {mounted && (
          <div className='mb-6 flex justify-center'>
            <CapsuleSwitch
              options={[
                ...(runtimeConfig.EMBY_ENABLED ? [{ label: 'Emby', value: 'emby' }] : []),
              ]}
              active={sourceType}
              onChange={(value) => setSourceType(value as LibrarySourceType)}
            />
          </div>
        )}

        {/* 第二级：Emby源选择（仅当选择Emby且有多个源时显示） */}
        {sourceType === 'emby' && embySourceOptions.length > 1 && (
          <div className='mb-6'>
            <div className='text-xs text-gray-500 dark:text-gray-400 mb-2 px-4'>
              服务
            </div>
            <div className='relative'>
              <div
                ref={embyScrollContainerRef}
                className='overflow-x-auto scrollbar-hide cursor-grab active:cursor-grabbing'
                onMouseDown={(e) => {
                  if (!embyScrollContainerRef.current) return;
                  isDraggingRef.current = true;
                  startXRef.current = e.pageX - embyScrollContainerRef.current.offsetLeft;
                  scrollLeftRef.current = embyScrollContainerRef.current.scrollLeft;
                  embyScrollContainerRef.current.style.cursor = 'grabbing';
                  embyScrollContainerRef.current.style.userSelect = 'none';
                }}
                onMouseLeave={() => {
                  if (!embyScrollContainerRef.current) return;
                  isDraggingRef.current = false;
                  embyScrollContainerRef.current.style.cursor = 'grab';
                  embyScrollContainerRef.current.style.userSelect = 'auto';
                }}
                onMouseUp={() => {
                  if (!embyScrollContainerRef.current) return;
                  isDraggingRef.current = false;
                  embyScrollContainerRef.current.style.cursor = 'grab';
                  embyScrollContainerRef.current.style.userSelect = 'auto';
                }}
                onMouseMove={(e) => {
                  if (!isDraggingRef.current || !embyScrollContainerRef.current) return;
                  e.preventDefault();
                  const x = e.pageX - embyScrollContainerRef.current.offsetLeft;
                  const walk = (x - startXRef.current) * 2;
                  embyScrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
                }}
              >
                <div className='flex gap-2 px-4 min-w-min'>
                  {embySourceOptions.map((option) => (
                    <button
                      key={option.key}
                      onClick={() => setEmbyKey(option.key)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${embyKey === option.key
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 第三级：Emby 媒体库分类选择器 */}
        {sourceType === 'emby' && (
          <div className='mb-6'>
            <div className='text-xs text-gray-500 dark:text-gray-400 mb-2 px-4'>
              分类
            </div>
            {loadingViews ? (
              <div className='flex justify-center'>
                <div className='w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin' />
              </div>
            ) : embyViews.length > 0 ? (
              <div className='relative'>
                <div
                  ref={scrollContainerRef}
                  className='overflow-x-auto scrollbar-hide cursor-grab active:cursor-grabbing'
                  onMouseDown={handleMouseDown}
                  onMouseLeave={handleMouseLeave}
                  onMouseUp={handleMouseUp}
                  onMouseMove={handleMouseMove}
                >
                  <div className='flex gap-2 px-4 min-w-min'>
                    <button
                      onClick={() => setSelectedView('all')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${selectedView === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                    >
                      全部
                    </button>
                    {embyViews.map((view) => (
                      <button
                        key={view.id}
                        onClick={() => setSelectedView(view.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${selectedView === view.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                      >
                        {view.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Emby 排序选择器 */}
        {sourceType === 'emby' && (
          <div className='mb-6'>
            <div className='text-xs text-gray-500 dark:text-gray-400 mb-2 px-4'>
              排序
            </div>
            <div className='px-4'>
              <div className='relative inline-flex rounded-full p-0.5 sm:p-1 bg-transparent gap-1 sm:gap-2'>
                {/* 排序字段选择 */}
                <div ref={sortButtonRef} className='relative'>
                  <button
                    onClick={handleSortButtonClick}
                    className={`relative z-10 px-1.5 py-0.5 sm:px-2 sm:py-1 md:px-4 md:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${showSortDropdown
                      ? isDefaultSort()
                        ? 'text-gray-900 dark:text-gray-100 cursor-default'
                        : 'text-green-600 dark:text-green-400 cursor-default'
                      : isDefaultSort()
                        ? 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 cursor-pointer'
                        : 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 cursor-pointer'
                      }`}
                  >
                    <span>{getSortDisplayText()}</span>
                    <svg
                      className={`inline-block w-2.5 h-2.5 sm:w-3 sm:h-3 ml-0.5 sm:ml-1 transition-transform duration-200 ${showSortDropdown ? 'rotate-180' : ''
                        }`}
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
                    </svg>
                  </button>
                </div>

                {/* 排序方向切换 */}
                <div className='relative'>
                  <button
                    onClick={toggleSortOrder}
                    className={`relative z-10 px-1.5 py-0.5 sm:px-2 sm:py-1 md:px-4 md:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${isDefaultSort()
                      ? 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 cursor-pointer'
                      : 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 cursor-pointer'
                      }`}
                    aria-label={sortOrder === 'Ascending' ? '升序' : '降序'}
                  >
                    {sortOrder === 'Ascending' ? (
                      <ArrowUpNarrowWide className='inline-block w-4 h-4 sm:w-4 sm:h-4' />
                    ) : (
                      <ArrowDownWideNarrow className='inline-block w-4 h-4 sm:w-4 sm:h-4' />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 排序下拉框 Portal */}
        {mounted && showSortDropdown && createPortal(
          <div
            ref={sortDropdownRef}
            className='fixed z-[9999] bg-white/95 dark:bg-gray-800/95 rounded-xl border border-gray-200/50 dark:border-gray-700/50 backdrop-blur-sm max-h-[50vh] flex flex-col'
            style={{
              left: `${sortDropdownPosition.x}px`,
              top: `${sortDropdownPosition.y}px`,
              minWidth: `${Math.max(sortDropdownPosition.width, 200)}px`,
              maxWidth: '300px',
              position: 'fixed',
            }}
          >
            <div className='p-2 sm:p-4 overflow-y-auto flex-1 min-h-0'>
              <div className='grid grid-cols-2 gap-1 sm:gap-2'>
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleSortOptionSelect(option.value)}
                    className={`px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-lg transition-all duration-200 text-left ${sortBy === option.value
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80'
                      }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}

        {error && (
          <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6'>
            <p className='text-red-800 dark:text-red-200'>{error}</p>
          </div>
        )}

        {loading ? (
          // Emby 加载骨架屏 - 海报卡片样式
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
            {Array.from({ length: pageSize }).map((_, index) => (
              <div
                key={index}
                className='animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg aspect-[2/3]'
              />
            ))}
          </div>
        ) : videos.length === 0 ? (
          <div className='text-center py-12'>
            <p className='text-gray-500 dark:text-gray-400'>
              暂无视频，请在管理面板配置 Emby
            </p>
          </div>
        ) : (
          <>
            <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
              {videos.map((video) => {
                // 构建source参数用于VideoCard
                // 如果是emby源且有embyKey，使用下划线格式
                let sourceParam = sourceType;
                if (sourceType === 'emby' && embyKey) {
                  sourceParam = `emby_${embyKey}`;
                }

                return (
                  <VideoCard
                    key={video.id}
                    id={video.id}
                    source={sourceParam}
                    title={video.title}
                    poster={video.poster}
                    year={video.year || (video.releaseDate ? video.releaseDate.split('-')[0] : '')}
                    rate={
                      video.rating
                        ? video.rating.toFixed(1)
                        : video.voteAverage && video.voteAverage > 0
                          ? video.voteAverage.toFixed(1)
                          : ''
                    }
                    from='search'
                  />
                );
              })}
            </div>

            {/* 滚动加载指示器 - 始终渲染以便 observer 可以监听 */}
            <div ref={observerTarget} className='flex justify-center items-center py-8 min-h-[100px]'>
              {loadingMore && (
                <div className='flex items-center gap-2 text-gray-600 dark:text-gray-400'>
                  <div className='w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin' />
                  <span>加载中...</span>
                </div>
              )}
              {!hasMore && videos.length > 0 && !loadingMore && (
                <div className='text-gray-500 dark:text-gray-400'>
                  已加载全部内容
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}
