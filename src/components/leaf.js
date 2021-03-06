
import Debug from 'debug'
import OffsetKey from '../utils/offset-key'
import React from 'react'
import ReactDOM from 'react-dom'
import getWindow from 'get-window'
import { IS_FIREFOX } from '../constants/environment'

/**
 * Debugger.
 *
 * @type {Function}
 */

const debug = Debug('slate:leaf')

/**
 * Leaf.
 *
 * @type {Component}
 */

class Leaf extends React.Component {

  /**
   * Property types.
   *
   * @type {Object}
   */

  static propTypes = {
    index: React.PropTypes.number.isRequired,
    isVoid: React.PropTypes.bool,
    marks: React.PropTypes.object.isRequired,
    node: React.PropTypes.object.isRequired,
    parent: React.PropTypes.object.isRequired,
    ranges: React.PropTypes.object.isRequired,
    schema: React.PropTypes.object.isRequired,
    state: React.PropTypes.object.isRequired,
    text: React.PropTypes.string.isRequired
  };

  /**
   * Default properties.
   *
   * @type {Object}
   */

  static defaultProps = {
    isVoid: false
  };

  /**
   * Constructor.
   *
   * @param {Object} props
   */

  constructor(props) {
    super(props)
    this.tmp = {}
    this.tmp.renders = 0
  }

  /**
   * Debug.
   *
   * @param {String} message
   * @param {Mixed} ...args
   */

  debug = (message, ...args) => {
    debug(message, `${this.props.node.key}-${this.props.index}`, ...args)
  }

  /**
   * Should component update?
   *
   * @param {Object} props
   * @return {Boolean}
   */

  shouldComponentUpdate(props) {
    // If any of the regular properties have changed, re-render.
    if (
      props.index != this.props.index ||
      props.marks != this.props.marks ||
      props.schema != this.props.schema ||
      props.text != this.props.text
    ) {
      return true
    }

    // If the DOM text does not equal the `text` property, re-render, this can
    // happen because React gets out of sync when previously natively rendered.
    const el = findDeepestNode(ReactDOM.findDOMNode(this))
    const text = this.renderText(props)
    if (el.textContent != text) return true

    // If the selection was previously focused, and now it isn't, re-render so
    // that the selection will be properly removed.
    if (this.props.state.isFocused && props.state.isBlurred) {
      const { index, node, ranges, state } = this.props
      const { start, end } = OffsetKey.findBounds(index, ranges)
      if (state.selection.hasEdgeBetween(node, start, end)) return true
    }

    // If the selection will be focused, only re-render if this leaf contains
    // one or both of the selection's edges.
    if (props.state.isFocused) {
      const { index, node, ranges, state } = props
      const { start, end } = OffsetKey.findBounds(index, ranges)
      if (state.selection.hasEdgeBetween(node, start, end)) return true
    }

    // Otherwise, don't update.
    return false
  }

  /**
   * When the DOM updates, try updating the selection.
   */

  componentDidMount() {
    this.updateSelection()
  }

  componentDidUpdate() {
    this.updateSelection()
  }

  /**
   * Update the DOM selection if it's inside the leaf.
   */

  updateSelection() {
    const { state, ranges } = this.props
    const { selection } = state

    // If the selection is blurred we have nothing to do.
    if (selection.isBlurred) return

    const { node, index } = this.props
    const { start, end } = OffsetKey.findBounds(index, ranges)
    const anchorOffset = selection.anchorOffset - start
    const focusOffset = selection.focusOffset - start

    // If neither matches, the selection doesn't start or end here, so exit.
    const hasAnchor = selection.hasAnchorBetween(node, start, end)
    const hasFocus = selection.hasFocusBetween(node, start, end)
    if (!hasAnchor && !hasFocus) return

    // We have a selection to render, so prepare a few things...
    const ref = ReactDOM.findDOMNode(this)
    const el = findDeepestNode(ref)
    const window = getWindow(el)
    const native = window.getSelection()
    const parent = ref.closest('[contenteditable]')

    // COMPAT: In Firefox, it's not enough to create a range, you also need to
    // focus the contenteditable element. (2016/11/16)
    function focus() {
      if (!IS_FIREFOX) return
      if (parent) setTimeout(() => parent.focus())
    }

    // If both the start and end are here, set the selection all at once.
    if (hasAnchor && hasFocus) {
      native.removeAllRanges()
      const range = window.document.createRange()
      range.setStart(el, anchorOffset)
      native.addRange(range)
      native.extend(el, focusOffset)
      focus()
    }

    // Otherwise we need to set the selection across two different leaves.
    else {
      // If the selection is forward, we can set things in sequence. In the
      // first leaf to render, reset the selection and set the new start. And
      // then in the second leaf to render, extend to the new end.
      if (selection.isForward) {
        if (hasAnchor) {
          native.removeAllRanges()
          const range = window.document.createRange()
          range.setStart(el, anchorOffset)
          native.addRange(range)
        } else if (hasFocus) {
          native.extend(el, focusOffset)
          focus()
        }
      }

      // Otherwise, if the selection is backward, we need to hack the order a bit.
      // In the first leaf to render, set a phony start anchor to store the true
      // end position. And then in the second leaf to render, set the start and
      // extend the end to the stored value.
      else {
        if (hasFocus) {
          native.removeAllRanges()
          const range = window.document.createRange()
          range.setStart(el, focusOffset)
          native.addRange(range)
        } else if (hasAnchor) {
          const endNode = native.focusNode
          const endOffset = native.focusOffset
          native.removeAllRanges()
          const range = window.document.createRange()
          range.setStart(el, anchorOffset)
          native.addRange(range)
          native.extend(endNode, endOffset)
          focus()
        }
      }
    }

    this.debug('updateSelection', { selection })
  }

  /**
   * Render the leaf.
   *
   * @return {Element}
   */

  render() {
    const { props } = this
    const { node, index } = props
    const offsetKey = OffsetKey.stringify({
      key: node.key,
      index
    })

    // Increment the renders key, which forces a re-render whenever this
    // component is told it should update. This is required because "native"
    // renders where we don't update the leaves cause React's internal state to
    // get out of sync, causing it to not realize the DOM needs updating.
    this.tmp.renders++


    this.debug('render', { props })

    return (
      <span key={this.tmp.renders} data-offset-key={offsetKey}>
        {this.renderMarks(props)}
      </span>
    )
  }

  /**
   * Render the text content of the leaf, accounting for browsers.
   *
   * @param {Object} props
   * @return {Element}
   */

  renderText(props) {
    const { node, state, parent, text, index, ranges } = props

    // COMPAT: If the text is empty and it's the only child, we need to render a
    // <br/> to get the block to have the proper height.
    if (text == '' && parent.kind == 'block' && parent.text == '') return <br />

    // COMPAT: If the text is empty otherwise, it's because it's on the edge of
    // an inline void node, so we render a zero-width space so that the
    // selection can be inserted next to it still.
    if (text == '') {
      // COMPAT: In Chrome, zero-width space produces graphics glitches, so use
      // hair space in place of it. (2017/02/12)
      const space = IS_FIREFOX ? '\u200B' : '\u200A'
      return <span data-slate-zero-width>{space}</span>
    }

    // COMPAT: Browsers will collapse trailing new lines at the end of blocks,
    // so we need to add an extra trailing new lines to prevent that.
    const block = state.document.getClosestBlock(node.key)
    const lastText = block.getLastText()
    const lastChar = text.charAt(text.length - 1)
    const isLastText = node == lastText
    const isLastRange = index == ranges.size - 1
    if (isLastText && isLastRange && lastChar == '\n') return `${text}\n`

    // Otherwise, just return the text.
    return text
  }

  /**
   * Render all of the leaf's mark components.
   *
   * @param {Object} props
   * @return {Element}
   */

  renderMarks(props) {
    const { marks, schema } = props
    const text = this.renderText(props)

    return marks.reduce((children, mark) => {
      const Component = mark.getComponent(schema)
      if (!Component) return children
      return <Component mark={mark} marks={marks}>{children}</Component>
    }, text)
  }
}

/**
 * Find the deepest descendant of a DOM `element`.
 *
 * @param {Element} node
 * @return {Element}
 */

function findDeepestNode(element) {
  return element.firstChild
    ? findDeepestNode(element.firstChild)
    : element
}

/**
 * Export.
 *
 * @type {Component}
 */

export default Leaf
